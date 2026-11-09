//! Install the built r-sure contracts into the node's own in-memory reducer and drive a
//! placement from syndicate creation through claim settlement. No devnet, no Docker, no
//! network.
//!
//! `tools/local_reducer.sh` generates a crate around this file, pointing it at the
//! RNodeRust checkout, and runs it. The point is to catch install-time and call-time
//! failures (free variables, sort errors, deadlock shapes) before any block is proposed.
//!
//! The reducer is the node's `RhoRuntime`, so the semantics are the node's. It is not a
//! substitute for the devnet campaign: r-cash, r-gen and finality are absent.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rchain_crypto::hash::blake2b256;
use rchain_crypto::hash::blake2b512_random::Blake2b512Random;
use rchain_crypto::public_key::PublicKey;
use rchain_crypto::signatures::secp256k1::Secp256k1;
use rchain_models::rholang::RhoType::{RhoDeployId, RhoDeployerId};
use rchain_models::runtime::{BindPattern, ListParWithRandom, TaggedContinuation};
use rchain_models::sorted::SortedProc;
use rchain_rholang::pretty_printer::PrettyPrinter;
use rchain_rholang::runtime::RhoRuntime;
use rchain_rholang::storage::RhoMatch;
use rchain_rholang::system_processes::BlockData;
use rchain_rspace::factory::create_history_repository;
use rchain_rspace::hot_store::InMemHotStore;
use rchain_rspace::rspace::RSpace;
use rchain_shared::refined::{BlockHeight, SeqNum};
use rchain_shared::store_manager::InMemoryStoreManager;

const ORDER: &[&str] = &[
    "00_root.rho",
    "01_kernel.rho",
    "02_admin.rho",
    "03_terms.rho",
    "04_math.rho",
    "05_rgen.rho",
    "40_payments.rho",
    "15_distribution.rho",
    "16_fund.rho",
    "10_syndicate.rho",
    "11_broker.rho",
    "12_risk.rho",
    "13_slip.rho",
    "14_line.rho",
    "17_policy.rho",
    "18_claim.rho",
    "19_books.rho",
];

// Deterministic local-only admin keys. The secrets live in this process, are never
// committed and are never used against a node; they exist so the reducer can sign a real
// 2-of-3 admin payload and exercise signature verification and pause scope.
fn admin_secret(index: usize) -> Vec<u8> {
    vec![(index as u8) + 1; 32]
}

fn admin_public(index: usize) -> Vec<u8> {
    Secp256k1::to_public_bytes(&admin_secret(index)).expect("deterministic secp256k1 key")
}

fn deployer_key() -> Vec<u8> {
    admin_public(0)
}

fn deployer_key_of(index: usize) -> Vec<u8> {
    admin_public(index)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

const PLATFORM: &str = "11112VYAt8rUGNRRZX3eJdgagaAhtWTK8Js7F7X5iqddMVqyDTtYau";

type Error = Box<dyn std::error::Error>;

struct Reducer {
    runtime: RhoRuntime,
    deploy: usize,
    deployer: Vec<u8>,
}

impl Reducer {
    async fn new() -> Result<Self, Error> {
        let manager = InMemoryStoreManager::default();
        let history = create_history_repository::<
            SortedProc,
            BindPattern,
            ListParWithRandom,
            TaggedContinuation,
        >(&manager, "rspace")
        .await?;
        let reader = history.get_history_reader(history.root()).await;
        let hot = Arc::new(InMemHotStore::new(reader.base()));
        let (play, _replay) = RSpace::create_with_replay(history.clone(), hot, Arc::new(RhoMatch));
        let runtime = RhoRuntime::create(play, history, SortedProc::default()).await?;
        runtime.set_block_data(BlockData {
            block_number: BlockHeight::zero(),
            sender: PublicKey::new(deployer_key()),
            seq_num: SeqNum::zero(),
            timestamp: 0,
        });
        Ok(Self {
            runtime,
            deploy: 0,
            deployer: deployer_key(),
        })
    }

    fn set_deployer(&mut self, key: Vec<u8>) {
        self.deployer = key;
    }

    /// Resolve a component key through the root and call one arm.
    async fn component_call(
        &mut self,
        root: &str,
        key: &str,
        arm: &str,
        args: &str,
    ) -> Result<String, Error> {
        let term = format!(
            "new rl(`rho:registry:lookup`), rootCh, resolveCh, capCh, reply, \
             dId(`rho:rchain:deployerId`), deployId(`rho:rchain:deployId`) in {{ \
             rl!(`{root}`, *rootCh) | \
             for (Root <- rootCh) {{ Root!(\"resolve\", \"{key}\", 1, *resolveCh) }} | \
             for (@(true, uri, _) <- resolveCh) {{ \
               rl!(uri, *capCh) | for (Cap <- capCh) {{ Cap!(\"{arm}\"{args}, *reply) }} }} | \
             for (@r <- reply) {{ deployId!(r) }} }}"
        );
        Ok(self.deploy(&term).await?.join(" "))
    }

    /// Build the canonical payload, sign it with two admin keys, and submit the action.
    async fn admin_action(
        &mut self,
        root: &str,
        action: &str,
        nonce: i64,
    ) -> Result<String, Error> {
        let payload = self
            .component_call(
                root,
                "component:codec",
                "adminPayload",
                &format!(r#", "admin", {nonce}, "{action}", []"#),
            )
            .await?;
        let payload = first_quoted(&payload)
            .ok_or_else(|| std::io::Error::other(format!("payload: {payload}")))?;
        let digest = blake2b256::hash(payload.as_bytes());
        let signatures = (0..2)
            .map(|index| {
                Secp256k1::sign_bytes(&digest, &admin_secret(index))
                    .map(|signature| hex(&signature))
                    .map_err(|error| std::io::Error::other(error.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let literal = format!(
            "[{}]",
            signatures
                .iter()
                .map(|signature| format!("\"{signature}\".hexToBytes()"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        self.component_call(
            root,
            "component:admin",
            "admin",
            &format!(r#", {nonce}, "{action}", [], {literal}"#),
        )
        .await
    }

    /// Call one arm on the root by URI.
    async fn root_call(&mut self, root: &str, arm: &str, args: &str) -> Result<String, Error> {
        let term = format!(
            "new rl(`rho:registry:lookup`), rootCh, reply, \
             dId(`rho:rchain:deployerId`), deployId(`rho:rchain:deployId`) in {{ \
             rl!(`{root}`, *rootCh) | \
             for (Root <- rootCh) {{ Root!(\"{arm}\"{args}, *reply) }} | \
             for (@r <- reply) {{ deployId!(r) }} }}"
        );
        Ok(self.deploy(&term).await?.join(" "))
    }

    /// Call one arm on a known URI.
    async fn uri_call(&mut self, uri: &str, arm: &str, args: &str) -> Result<String, Error> {
        let term = format!(
            "new rl(`rho:registry:lookup`), capCh, reply, \
             dId(`rho:rchain:deployerId`), deployId(`rho:rchain:deployId`) in {{ \
             rl!(`{uri}`, *capCh) | \
             for (Cap <- capCh) {{ Cap!(\"{arm}\"{args}, *reply) }} | \
             for (@r <- reply) {{ deployId!(r) }} }}"
        );
        Ok(self.deploy(&term).await?.join(" "))
    }

    /// Evaluate one term as a deploy and return the pretty-printed reply data.
    async fn deploy(&mut self, term: &str) -> Result<Vec<String>, Error> {
        self.deploy += 1;
        let id = vec![self.deploy as u8; 64];
        let mut env = BTreeMap::new();
        env.insert(
            "rho:rchain:deployerId".to_string(),
            RhoDeployerId::apply(self.deployer.clone()),
        );
        env.insert(
            "rho:rchain:deployId".to_string(),
            RhoDeployId::apply(id.clone()),
        );
        let rand = Blake2b512Random::new_random(128);
        let result = self.runtime.evaluate_with_env(term, &env, &rand).await?;
        if !result.errors.is_empty() {
            return Err(std::io::Error::other(format!(
                "deploy {} reduced with errors: {:?}",
                self.deploy, result.errors
            ))
            .into());
        }
        let channel = SortedProc::new(RhoDeployId::apply(id));
        let data = self.runtime.get_data_par(&channel).await?;
        let printer = PrettyPrinter::new();
        Ok(data.iter().map(|par| printer.build_string(par)).collect())
    }
}

fn render(source: &str, root: &str, rcash: &str) -> String {
    let admins = format!(
        "[{}]",
        (0..3)
            .map(|index| format!("\"{}\".hexToBytes()", hex(&admin_public(index))))
            .collect::<Vec<_>>()
            .join(", ")
    );
    [
        ("__ADMINS__", admins.as_str()),
        ("__THRESHOLD__", "2"),
        ("__ROOT_URI__", root),
        ("__RCASH_ROOT_URI__", rcash),
        ("__PLATFORM_OWNER__", PLATFORM),
        ("__RGEN_ROOT_URI__", ""),
    ]
    .into_iter()
    .fold(source.to_string(), |text, (key, value)| {
        text.replace(key, value)
    })
}

fn expect_refusal(label: &str, reply: &str, reason: &str) -> Result<(), Error> {
    let expected = format!("(false, \"{reason}\"");
    if !reply.contains(&expected) {
        return Err(std::io::Error::other(format!(
            "{label}: expected refusal {reason:?}, got {reply}"
        ))
        .into());
    }
    println!("local-reducer: refused {label} -> {reason}");
    Ok(())
}

fn first_quoted(text: &str) -> Option<String> {
    let start = text.find('"')? + 1;
    let rest = &text[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn find_uri(text: &str) -> Option<String> {
    let start = text.find("rho:id:")?;
    let rest = &text[start..];
    let end = rest
        .char_indices()
        .find(|(_, ch)| !(ch.is_ascii_alphanumeric() || *ch == ':'))
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

fn build_dir() -> Result<PathBuf, Error> {
    let dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new("contracts/build").to_path_buf());
    if !dir.is_dir() {
        return Err(std::io::Error::other(format!(
            "{} is missing; run `make build` first",
            dir.display()
        ))
        .into());
    }
    Ok(dir)
}

fn vectors_path() -> PathBuf {
    std::env::args()
        .nth(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new("spec/vectors/core.json").to_path_buf())
}

fn ints(text: &str) -> Vec<i64> {
    text.split(',')
        .filter_map(|part| part.trim().parse().ok())
        .collect()
}

fn sum_amounts(reply: &str) -> i64 {
    reply
        .split("\"amount\" : ")
        .skip(1)
        .filter_map(|rest| {
            rest.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<i64>()
                .ok()
        })
        .sum()
}

async fn check_curve_math(reducer: &mut Reducer, root: &str) -> Result<(), Error> {
    let value_curve = r#"[0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500]"#;
    let loss_curve = r#"[2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000]"#;
    let stats = reducer
        .component_call(
            root,
            "component:suremath",
            "curveStats",
            &format!(
                ", {{\"kind\":\"quantiles\",\"unit\":\"bpsOfDeclaredValue\",\"n\":16,\"points\":{value_curve}}}"
            ),
        )
        .await?;
    if !stats.contains("\"varianceBps\"") || !stats.contains("\"ss\"") {
        return Err(std::io::Error::other(format!("curveStats: {stats}")).into());
    }
    let delta = reducer
        .component_call(
            root,
            "component:suremath",
            "curveDelta",
            &format!(
                ", {{\"kind\":\"quantiles\",\"unit\":\"bpsOfDeclaredValue\",\"n\":16,\"points\":{loss_curve}}}, {{\"kind\":\"quantiles\",\"unit\":\"bpsOfDeclaredValue\",\"n\":16,\"points\":{value_curve}}}, 2000, 2000"
            ),
        )
        .await?;
    for needle in [
        "\"relativeVarianceGapBps\" : 0",
        "\"shapeL1Bps\" : 0",
        "\"maxDevGapBps\" : 0",
        "\"curveFlagged\" : false",
        "\"rateGapBps\"",
        "\"meanGapBps\"",
    ] {
        if !delta.contains(needle) {
            return Err(
                std::io::Error::other(format!("curveDelta missing {needle}: {delta}")).into(),
            );
        }
    }
    println!("local-reducer: curve stats and reflection delta -> {delta}");
    Ok(())
}

async fn check_model_vectors(
    reducer: &mut Reducer,
    root: &str,
    path: &Path,
) -> Result<usize, Error> {
    let document: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let vectors = document["vectors"]
        .as_object()
        .ok_or_else(|| std::io::Error::other(format!("{}: no vectors", path.display())))?;
    let mut checked = 0;
    for (name, vector) in vectors {
        let Some(rest) = name.strip_prefix("math.") else {
            continue;
        };
        let input = vector["input"].as_str().unwrap_or("");
        let output = vector["output"].as_str().unwrap_or("");
        let reply = if rest.starts_with("share.") {
            let values = ints(input);
            reducer
                .component_call(
                    root,
                    "component:suremath",
                    "share",
                    &format!(", {}, {}", values[0], values[1]),
                )
                .await?
        } else if rest == "split.conserve" {
            let values = ints(input);
            reducer
                .component_call(
                    root,
                    "component:suremath",
                    "premiumSplit",
                    &format!(", {}, {}, {}", values[0], values[1], values[2]),
                )
                .await?
        } else if rest.starts_with("payable.") {
            let values = ints(input);
            reducer
                .component_call(
                    root,
                    "component:suremath",
                    "payable",
                    &format!(
                        ", {}, {}, {}, {}",
                        values[0], values[1], values[2], values[3]
                    ),
                )
                .await?
        } else if rest.starts_with("alloc.") {
            let (net, shares) = input
                .split_once(',')
                .ok_or_else(|| std::io::Error::other(format!("{name}: input {input}")))?;
            let bps = shares
                .trim()
                .trim_start_matches('[')
                .trim_end_matches(']')
                .split(',')
                .map(|part| format!("{{\"shareBps\": {}}}", part.trim()))
                .collect::<Vec<_>>()
                .join(", ");
            reducer
                .component_call(
                    root,
                    "component:suremath",
                    "lineShares",
                    &format!(", {}, [{}]", net.trim(), bps),
                )
                .await?
        } else {
            return Err(std::io::Error::other(format!("{name}: unknown math vector")).into());
        };

        let reply = reply.trim();
        let matched = if rest.starts_with("share.") {
            let values = ints(input);
            let part: i64 = output.parse()?;
            reply == format!("(true, {part}, {})", values[0] - part)
        } else if rest.starts_with("alloc.") {
            let expected: i64 = output.parse()?;
            sum_amounts(reply) == expected
        } else {
            let expected = output
                .split(',')
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(", ");
            reply == format!("(true, {expected})")
        };
        if !matched {
            return Err(
                std::io::Error::other(format!("{name}: expected {output}, got {reply}")).into(),
            );
        }
        checked += 1;
    }

    for (name, vector) in vectors {
        let Some(rest) = name.strip_prefix("variance.") else {
            continue;
        };
        let input = vector["input"].as_str().unwrap_or("");
        let output = vector["output"].as_str().unwrap_or("");
        let (arm, args, expected) = if rest.starts_with("rate.")
            && !rest.starts_with("rate.two-point")
            && !rest.starts_with("rate.scale")
        {
            let parts = input.split(',').map(str::trim).collect::<Vec<_>>();
            if parts.len() != 2 {
                return Err(std::io::Error::other(format!("{name}: input {input}")).into());
            }
            let verdict = format!("\"{}\"", parts[1]);
            (
                "varianceRate",
                format!(", {}, {}", parts[0], verdict),
                format!("(true, {output})"),
            )
        } else if rest.starts_with("ss.") || rest == "rate.two-point" || rest == "rate.scale" {
            let values = input
                .split(',')
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(", ");
            let expected = if rest.starts_with("ss.") {
                format!(", {output})")
            } else {
                format!("(true, {output},")
            };
            ("varianceStats", format!(", [{values}]"), expected)
        } else if rest.starts_with("gap.") {
            let values = ints(input);
            if values.len() != 3 {
                return Err(std::io::Error::other(format!("{name}: input {input}")).into());
            }
            let parts = output.split(',').map(str::trim).collect::<Vec<_>>();
            (
                "varianceGap",
                format!(", {}, {}, {}", values[0], values[1], values[2]),
                format!("(true, {}, {})", parts[0], parts[1]),
            )
        } else if rest.starts_with("load.") {
            let values = ints(input);
            if values.len() != 3 {
                return Err(std::io::Error::other(format!("{name}: input {input}")).into());
            }
            (
                "loadedPremium",
                format!(", {}, {}, {}", values[0], values[1], values[2]),
                format!("(true, {output})"),
            )
        } else {
            return Err(std::io::Error::other(format!("{name}: unknown variance vector")).into());
        };
        let reply = reducer
            .component_call(root, "component:suremath", arm, &args)
            .await?;
        let reply = reply.trim();
        let matched = if rest.starts_with("ss.") {
            reply.ends_with(&expected)
        } else if rest == "rate.two-point" || rest == "rate.scale" {
            reply.starts_with(&expected)
        } else {
            reply == expected
        };
        if !matched {
            return Err(std::io::Error::other(format!(
                "{name}: expected {}, got {reply}",
                expected
            ))
            .into());
        }
        checked += 1;
    }
    Ok(checked)
}

async fn run() -> Result<(), Error> {
    let build = build_dir()?;
    let mut reducer = Reducer::new().await?;

    let stub = r#"new rs(`rho:registry:insertArbitrary`), resolverCh, factoryCh, rootCh,
    deployId(`rho:rchain:deployId`), Resolver, AccountFactory, Account, Facet, Root,
    Issuer, Purse in {
  contract Resolver(@"issuer", @assetId, ret) = { ret!((true, "REV-brand", *Issuer)) } |
  contract Issuer(@"makeEmptyPurse", ret) = { ret!((true, *Purse)) } |
  contract Issuer(@"getAmountOf", @payment, ret) = { match payment { "premium:1000" => { ret!((true, 1000)) } "stub-payment" => { ret!((true, 6000)) } amount => { ret!((true, amount)) } } } |
  contract Purse(@"deposit", @payment, ret) = { ret!((true, 0)) } |
  contract Purse(@"getAmountOf", @payment, ret) = { ret!((true, 6000)) } |
  contract Purse(@"getCurrentAmount", ret) = { ret!((true, 6000)) } |
  contract Purse(@"withdraw", @spec, ret) = { match spec { (brand, amount) => { ret!((true, amount)) } } } |
  contract AccountFactory(@"accountOf", @owner, ret) = { ret!((true, *Account)) } |
  contract AccountFactory(@"getOrCreate", @pk, ret) = { ret!((true, *Account, "stub-owner")) } |
  contract Account(@"depositFacet", @assetId, ret) = { ret!((true, *Facet)) } |
  contract Account(@"deposit", @payment, ret) = { ret!((true, 0)) } |
  contract Facet(@"deposit", @payment, ret) = { ret!((true, 0)) } |
  rs!(bundle+{*Resolver}, *resolverCh) |
  rs!(bundle+{*AccountFactory}, *factoryCh) |
  for (@resolverUri <- resolverCh; @factoryUri <- factoryCh) {
    contract Root(@"resolve", @key, @minVersion, ret) = {
      if (key == "component:asset-resolver") { ret!((true, resolverUri, 1)) }
      else {
        if (key == "component:account-factory") { ret!((true, factoryUri, 1)) }
        else { ret!((false, "unknown", key)) }
      }
    } |
    rs!(bundle+{*Root}, *rootCh) |
    for (@uri <- rootCh) { deployId!([uri]) }
  }
}"#;
    let rcash = reducer.deploy(stub).await?.join(" ");
    let rcash = find_uri(&rcash)
        .ok_or_else(|| std::io::Error::other(format!("rcash stub: no URI in {rcash}")))?;
    println!("local-reducer: r-cash stub {rcash}");

    let mut root = String::new();
    for name in ORDER {
        let source = std::fs::read_to_string(build.join(name))?;
        let term = render(&source, &root, &rcash);
        let replies = reducer.deploy(&term).await?;
        let joined = replies.join(" ");
        if name == &"00_root.rho" {
            root = find_uri(&joined).ok_or_else(|| {
                std::io::Error::other(format!("00_root.rho: no root URI in {joined}"))
            })?;
            println!("local-reducer: root {root}");
        } else if replies.is_empty() {
            return Err(std::io::Error::other(format!("{name}: no reply")).into());
        } else {
            println!("local-reducer: installed {name}");
        }
    }

    let resolve = format!(
        "new rl(`rho:registry:lookup`), rootCh, reply, deployId(`rho:rchain:deployId`) in {{ \
         rl!(`{root}`, *rootCh) | \
         for (Root <- rootCh) {{ Root!(\"resolve\", \"component:clock\", 1, *reply) }} | \
         for (@r <- reply) {{ deployId!(r) }} }}"
    );
    let clock = reducer.deploy(&resolve).await?.join(" ");
    if !clock.contains("true") || !clock.contains("rho:id:") {
        return Err(std::io::Error::other(format!("resolve clock: {clock}")).into());
    }
    println!("local-reducer: resolve component:clock -> {clock}");

    let keys = format!(
        "new rl(`rho:registry:lookup`), rootCh, reply, deployId(`rho:rchain:deployId`) in {{ \
         rl!(`{root}`, *rootCh) | \
         for (Root <- rootCh) {{ Root!(\"keys\", *reply) }} | \
         for (@r <- reply) {{ deployId!(r) }} }}"
    );

    let math = format!(
        "new rl(`rho:registry:lookup`), rootCh, resolveCh, capCh, mathCh, \
         deployId(`rho:rchain:deployId`) in {{ \
         rl!(`{root}`, *rootCh) | \
         for (Root <- rootCh) {{ Root!(\"resolve\", \"component:suremath\", 1, *resolveCh) }} | \
         for (@(true, uri, _) <- resolveCh) {{ \
           rl!(uri, *capCh) | \
           for (SureMath <- capCh) {{ SureMath!(\"share\", 1000, 250, *mathCh) }} }} | \
         for (@m <- mathCh) {{ deployId!(m) }} }}"
    );
    let share = reducer.deploy(&math).await?.join(" ");
    if !share.contains("true") || !share.contains("25") || !share.contains("975") {
        return Err(std::io::Error::other(format!("suremath share: {share}")).into());
    }
    println!("local-reducer: suremath share(1000, 250) -> {share}");

    let vectors = check_model_vectors(&mut reducer, &root, &vectors_path()).await?;
    println!("local-reducer: {vectors} model vectors match SureMath");
    check_curve_math(&mut reducer, &root).await?;

    let address = reducer
        .deploy(
            "new dops(`rho:rchain:deployerId:ops`), rev(`rho:rev:address`), \
             dId(`rho:rchain:deployerId`), pkCh, addrCh, \
             deployId(`rho:rchain:deployId`) in { \
             dops!(\"pubKeyBytes\", *dId, *pkCh) | \
             for (@pk <- pkCh) { rev!(\"fromPublicKey\", pk, *addrCh) } | \
             for (@a <- addrCh) { deployId!(a) } }",
        )
        .await?
        .join(" ");
    let insured = first_quoted(&address)
        .ok_or_else(|| std::io::Error::other(format!("insured address: {address}")))?;
    println!("local-reducer: insured {insured}");

    let syndicate_args =
        r#", *dId, {"name": "local-syndicate", "assetId": "REV", "riskAppetite": ["property"]}"#;
    let syndicate = reducer
        .component_call(&root, "component:syndicate-book", "create", syndicate_args)
        .await?;
    let syndicate_id = first_quoted(&syndicate)
        .ok_or_else(|| std::io::Error::other(format!("syndicate create: {syndicate}")))?;
    let syndicate_uri = find_uri(&syndicate)
        .ok_or_else(|| std::io::Error::other(format!("syndicate create: {syndicate}")))?;
    println!("local-reducer: syndicate {syndicate_id} {syndicate_uri}");

    let contributed = reducer
        .uri_call(&syndicate_uri, "contribute", r#", *dId, "stub-payment""#)
        .await?;
    if !contributed.contains("true") {
        return Err(std::io::Error::other(format!("contribute: {contributed}")).into());
    }
    println!("local-reducer: contributed {contributed}");

    let broker_args = r#", *dId, {"name": "local-broker", "licenceHash": "licence:local", "commissionBps": 1000, "classes": ["property"]}"#;
    let broker = reducer
        .component_call(&root, "component:broker-book", "register", broker_args)
        .await?;
    if !broker.contains("true") || !broker.contains("rho:id:") {
        return Err(std::io::Error::other(format!("broker register: {broker}")).into());
    }
    println!("local-reducer: broker {broker}");

    let risk_args = r#", *dId, {"class": "property", "assetRef": {"kind": "site", "hash": "asset:local"}, "evidence": [{"kind": "loss-run", "hash": "loss:local"}], "triTest": {"exposureRef": "exposure:local", "probabilityBasis": "claims-history", "consequenceBasis": "declared-value", "consequenceRef": "consequence:local"}, "periodStart": 0, "periodEnd": 1000000, "declaredValue": 5000, "requestedLimit": 1000, "requestedDeductible": 0}"#;
    let risk = reducer
        .component_call(&root, "component:risk-book", "submit", risk_args)
        .await?;
    let risk_id =
        first_quoted(&risk).ok_or_else(|| std::io::Error::other(format!("risk submit: {risk}")))?;
    let risk_uri =
        find_uri(&risk).ok_or_else(|| std::io::Error::other(format!("risk submit: {risk}")))?;
    println!("local-reducer: risk {risk_id} {risk_uri}");

    let terms = r#"{"coverageClass": "property", "assetId": "REV", "aggregateLimit": 5000, "perClaimLimit": 1000, "deductible": 0, "premiumTotal": 1000, "periodStartHeight": 0, "periodEndHeight": 1000000, "waitingBlocks": 0, "noticeBlocks": 1000, "runOffBlocks": 100, "standardClaimMax": 1000, "minSyndicates": 1, "maxSyndicates": 1, "brokerCommissionBps": 1000, "centralFundBps": 250, "evidencePolicy": "optional", "claimsLeadPolicy": "lead"}"#;
    let mut slip_args = String::from(", *dId, {\"riskId\": ");
    slip_args.push_str(&format!("{risk_id:?}, \"riskUri\": {risk_uri:?}, \"insured\": {insured:?}, \"class\": \"property\", \"terms\": "));
    slip_args.push_str(terms);
    slip_args.push_str(", \"expiryHeight\": 1000000}");
    let slip = reducer
        .component_call(&root, "component:slip-factory", "open", &slip_args)
        .await?;
    if !slip.contains("true") || !slip.contains("rho:id:") {
        return Err(std::io::Error::other(format!("slip open: {slip}")).into());
    }
    println!("local-reducer: slip {slip}");

    let slip_id =
        first_quoted(&slip).ok_or_else(|| std::io::Error::other(format!("slip open: {slip}")))?;
    let slip_uri =
        find_uri(&slip).ok_or_else(|| std::io::Error::other(format!("slip open: {slip}")))?;

    let subscribe_args = format!(r#", *dId, "{syndicate_uri}", 10000"#);
    let subscribed = reducer
        .uri_call(&slip_uri, "subscribe", &subscribe_args)
        .await?;
    if !subscribed.contains("true") {
        return Err(std::io::Error::other(format!("subscribe: {subscribed}")).into());
    }
    println!("local-reducer: subscribed {subscribed}");

    let accepted = reducer.uri_call(&slip_uri, "accept", ", *dId").await?;
    if !accepted.contains("true") {
        return Err(std::io::Error::other(format!("accept: {accepted}")).into());
    }
    println!("local-reducer: accepted {accepted}");

    let funded = reducer
        .uri_call(&slip_uri, "fundPremium", r#", *dId, "premium:1000""#)
        .await?;
    if !funded.contains("true") {
        return Err(std::io::Error::other(format!("fundPremium: {funded}")).into());
    }
    println!("local-reducer: funded {funded}");

    let bind = reducer.uri_call(&slip_uri, "bind", "").await?;
    if !bind.contains("true") || !bind.contains("rho:id:") {
        let slip_info = reducer.uri_call(&slip_uri, "info", "").await?;
        let quotes = reducer.uri_call(&syndicate_uri, "quotes", "").await?;
        let lines = reducer.uri_call(&syndicate_uri, "lines", "").await?;
        return Err(std::io::Error::other(format!(
            "bind: {bind}\n  slip: {slip_info}\n  quotes: {quotes}\n  lines: {lines}"
        ))
        .into());
    }
    println!("local-reducer: bound {slip_id} -> {bind}");

    let policy_uri =
        find_uri(&bind).ok_or_else(|| std::io::Error::other(format!("bind: {bind}")))?;
    let claim_req = r#", *dId, {"lossHeight": 0, "claimedAmount": 800, "evidence": [{"kind": "loss", "hash": "loss:local"}]}"#;
    let claim = reducer
        .uri_call(&policy_uri, "openClaim", claim_req)
        .await?;
    let claim_id =
        first_quoted(&claim).ok_or_else(|| std::io::Error::other(format!("openClaim: {claim}")))?;
    let claim_uri =
        find_uri(&claim).ok_or_else(|| std::io::Error::other(format!("openClaim: {claim}")))?;
    println!("local-reducer: claim {claim_id} {claim_uri}");

    let classified = reducer
        .uri_call(&claim_uri, "classify", r#", *dId, "standard""#)
        .await?;
    if !classified.contains("true") {
        return Err(std::io::Error::other(format!("classify: {classified}")).into());
    }
    let assessed = reducer
        .uri_call(
            &claim_uri,
            "assess",
            r#", *dId, {"recommendedAmount": 800, "basisHash": "assessment"}"#,
        )
        .await?;
    if !assessed.contains("true") {
        return Err(std::io::Error::other(format!("assess: {assessed}")).into());
    }
    let agreed = reducer
        .uri_call(&claim_uri, "agree", r#", *dId, 800, "agreement""#)
        .await?;
    if !agreed.contains("true") {
        return Err(std::io::Error::other(format!("agree: {agreed}")).into());
    }
    println!("local-reducer: claim agreed -> {agreed}");

    let settled = reducer.uri_call(&claim_uri, "settle", "").await?;
    if !settled.contains("true") {
        return Err(std::io::Error::other(format!("settle: {settled}")).into());
    }
    let closed = reducer.uri_call(&claim_uri, "close", "").await?;
    if !closed.contains("true") {
        return Err(std::io::Error::other(format!("close: {closed}")).into());
    }
    let claim_info = reducer.uri_call(&claim_uri, "info", "").await?;
    if !claim_info.contains("closed") || !claim_info.contains(r#""paid" : 800"#) {
        return Err(std::io::Error::other(format!("claim info: {claim_info}")).into());
    }
    println!("local-reducer: claim settled and closed");

    let rebind = reducer.uri_call(&slip_uri, "bind", "").await?;
    expect_refusal("bind is one-shot", &rebind, "closed")?;

    let late_settle = reducer.uri_call(&claim_uri, "settle", "").await?;
    expect_refusal("settle after close", &late_settle, "not agreed")?;

    let late_classify = reducer
        .uri_call(&claim_uri, "classify", r#", *dId, "standard""#)
        .await?;
    expect_refusal("classify after close", &late_classify, "closed")?;

    let unknown = reducer
        .root_call(&root, "resolve", r#", "component:missing", 1"#)
        .await?;
    expect_refusal("unknown component", &unknown, "unknown component")?;

    let duplicate = reducer
        .root_call(
            &root,
            "register",
            r#", "component:clock", "rho:id:local-duplicate", 1, "probe", *dId"#,
        )
        .await?;
    expect_refusal("duplicate register", &duplicate, "duplicate")?;

    reducer.set_deployer(deployer_key_of(1));
    let unauthorised = reducer
        .root_call(
            &root,
            "register",
            r#", "probe:unauthorised", "rho:id:local-probe", 1, "probe", *dId"#,
        )
        .await?;
    expect_refusal("non-installer register", &unauthorised, "not installer")?;
    reducer.set_deployer(deployer_key());

    let duplicate_syndicate = reducer
        .component_call(&root, "component:syndicate-book", "create", syndicate_args)
        .await?;
    expect_refusal(
        "duplicate syndicate",
        &duplicate_syndicate,
        "duplicate owner",
    )?;

    let duplicate_broker = reducer
        .component_call(&root, "component:broker-book", "register", broker_args)
        .await?;
    expect_refusal("duplicate broker", &duplicate_broker, "duplicate owner")?;

    let replay = reducer
        .component_call(
            &root,
            "component:admin",
            "admin",
            r#", 0, "pauseAll", [], []"#,
        )
        .await?;
    expect_refusal("admin replay", &replay, "replay")?;

    let below_threshold = reducer
        .component_call(
            &root,
            "component:admin",
            "admin",
            r#", 1, "pauseAll", [], []"#,
        )
        .await?;
    expect_refusal("admin below threshold", &below_threshold, "below threshold")?;

    let blank_terms = reducer
        .component_call(&root, "component:terms", "validate", ", {}")
        .await?;
    expect_refusal("blank terms", &blank_terms, "class")?;

    let assetless_terms = reducer
        .component_call(
            &root,
            "component:terms",
            "validate",
            r#", {"coverageClass": "property"}"#,
        )
        .await?;
    expect_refusal("terms without asset", &assetless_terms, "asset")?;

    reducer.set_deployer(deployer_key_of(1));
    let not_insured = reducer
        .uri_call(&policy_uri, "openClaim", r#", *dId, {}"#)
        .await?;
    expect_refusal("non-insured claim", &not_insured, "not insured")?;
    reducer.set_deployer(deployer_key());

    let late_loss = reducer
        .uri_call(
            &policy_uri,
            "openClaim",
            r#", *dId, {"lossHeight": 1010000, "claimedAmount": 100, "evidence": []}"#,
        )
        .await?;
    expect_refusal("loss after period", &late_loss, "notice")?;

    let zero_claim = reducer
        .uri_call(
            &policy_uri,
            "openClaim",
            r#", *dId, {"lossHeight": 0, "claimedAmount": 0, "evidence": []}"#,
        )
        .await?;
    expect_refusal("zero claim", &zero_claim, "amount")?;

    let second = reducer
        .uri_call(
            &policy_uri,
            "openClaim",
            r#", *dId, {"lossHeight": 0, "claimedAmount": 500, "evidence": [{"kind": "loss", "hash": "loss:second"}]}"#,
        )
        .await?;
    if !second.contains("true") {
        return Err(std::io::Error::other(format!("second claim: {second}")).into());
    }
    let second_uri = find_uri(&second)
        .ok_or_else(|| std::io::Error::other(format!("second claim: {second}")))?;
    println!("local-reducer: second claim {second_uri}");

    let early_settle = reducer.uri_call(&second_uri, "settle", "").await?;
    expect_refusal("settle before agreement", &early_settle, "not agreed")?;

    let early_assess = reducer
        .uri_call(
            &second_uri,
            "assess",
            r#", *dId, {"recommendedAmount": 500, "basisHash": "assessment"}"#,
        )
        .await?;
    expect_refusal("assess before classify", &early_assess, "not manager")?;

    let classified_second = reducer
        .uri_call(&second_uri, "classify", r#", *dId, "standard""#)
        .await?;
    if !classified_second.contains("true") {
        return Err(std::io::Error::other(format!("classify second: {classified_second}")).into());
    }
    reducer.set_deployer(deployer_key_of(1));
    let non_lead = reducer
        .uri_call(&second_uri, "agree", r#", *dId, 500, "agreement""#)
        .await?;
    expect_refusal("non-lead agree", &non_lead, "not lead")?;
    reducer.set_deployer(deployer_key());

    let terminal_agree = reducer
        .uri_call(&claim_uri, "agree", r#", *dId, 100, "basis""#)
        .await?;
    expect_refusal("terminal agree", &terminal_agree, "closed")?;

    let terminal_evidence = reducer
        .uri_call(&claim_uri, "addEvidence", r#", *dId, []"#)
        .await?;
    expect_refusal("terminal evidence", &terminal_evidence, "closed")?;

    let unknown_policy_claim = reducer
        .uri_call(&policy_uri, "claim", r#", "clm:missing""#)
        .await?;
    expect_refusal(
        "unknown policy claim",
        &unknown_policy_claim,
        "unknown claim",
    )?;

    let unknown_book_claim = reducer
        .component_call(&root, "component:claim-book", "claim", r#", "clm:missing""#)
        .await?;
    expect_refusal("unknown book claim", &unknown_book_claim, "unknown claim")?;

    let before_pause = reducer
        .component_call(&root, "component:admin", "isPaused", "")
        .await?;
    if !before_pause.contains("true, false") {
        return Err(std::io::Error::other(format!("initial pause state: {before_pause}")).into());
    }

    let pause = reducer.admin_action(&root, "pauseAll", 1).await?;
    if !pause.contains("true") {
        return Err(std::io::Error::other(format!("pauseAll: {pause}")).into());
    }
    let paused = reducer
        .component_call(&root, "component:admin", "isPaused", "")
        .await?;
    if !paused.contains("true, true") {
        return Err(std::io::Error::other(format!("paused state: {paused}")).into());
    }

    let blocked = reducer
        .component_call(&root, "component:syndicate-book", "create", syndicate_args)
        .await?;
    expect_refusal("paused syndicate create", &blocked, "paused")?;

    let read_while_paused = reducer
        .root_call(&root, "resolve", r#", "component:clock", 1"#)
        .await?;
    if !read_while_paused.contains("true") {
        return Err(
            std::io::Error::other(format!("read while paused: {read_while_paused}")).into(),
        );
    }

    let resume = reducer.admin_action(&root, "resumeAll", 2).await?;
    if !resume.contains("true") {
        return Err(std::io::Error::other(format!("resumeAll: {resume}")).into());
    }
    let resumed = reducer
        .component_call(&root, "component:admin", "isPaused", "")
        .await?;
    if !resumed.contains("true, false") {
        return Err(std::io::Error::other(format!("resumed state: {resumed}")).into());
    }
    let after_resume = reducer
        .component_call(&root, "component:syndicate-book", "create", syndicate_args)
        .await?;
    expect_refusal("create after resume", &after_resume, "duplicate owner")?;
    println!("local-reducer: pause and resume with two admin signatures");

    // A stub K-Asset exercises the r-gen read path without installing r-gen.
    let kasset_stub = r#"new rs(`rho:registry:insertArbitrary`), uriCh,
    deployId(`rho:rchain:deployId`), KAsset in {
  contract KAsset(@"get", ret) = {
    ret!((true, {
      "id": "rho:id:local-kasset",
      "quantity": {"unit": "inspections", "value": 12},
      "quality": {"completeness": 3, "correctness": 3,
                  "traceability": 3, "fitness": 3},
      "verdict": "valid",
      "status": "approved",
      "approval": {"decision": "approve",
                   "liability": {"responsible": "approver", "shareBps": 10000}}
    }))
  } |
  rs!(bundle+{*KAsset}, *uriCh) |
  for (@u <- uriCh) { deployId!([u]) }
}"#;
    let kasset_reply = reducer.deploy(kasset_stub).await?.join(" ");
    let kasset_uri = find_uri(&kasset_reply)
        .ok_or_else(|| std::io::Error::other(format!("kasset stub: {kasset_reply}")))?;
    let derived = reducer
        .component_call(
            &root,
            "component:rgen",
            "variance",
            &format!(r#", "{kasset_uri}""#),
        )
        .await?;
    if !derived.contains("true") || !derived.contains("4000") {
        return Err(std::io::Error::other(format!("kasset variance: {derived}")).into());
    }
    println!("local-reducer: kasset variance -> {derived}");

    // A value proposition declares its variance; the claim snapshots it and the
    // K-Asset carries it, so the adapter reads the declared rate instead of deriving.
    let declared_stub = r#"new rs(`rho:registry:insertArbitrary`), uriCh,
    deployId(`rho:rchain:deployId`), KAsset in {
  contract KAsset(@"get", ret) = {
    ret!((true, {
      "id": "rho:id:local-kasset-declared",
      "quantity": {"unit": "m3", "value": 100},
      "quality": {"completeness": 3, "correctness": 3,
                  "traceability": 3, "fitness": 3},
      "variance": {"quantityBps": 400, "qualityBps": 1200, "n": 30},
      "verdict": "valid",
      "status": "approved",
      "approval": {"decision": "approve",
                   "liability": {"responsible": "approver", "shareBps": 10000}}
    }))
  } |
  rs!(bundle+{*KAsset}, *uriCh) |
  for (@u <- uriCh) { deployId!([u]) }
}"#;
    let declared_reply = reducer.deploy(declared_stub).await?.join(" ");
    let declared_uri = find_uri(&declared_reply)
        .ok_or_else(|| std::io::Error::other(format!("declared stub: {declared_reply}")))?;
    let declared = reducer
        .component_call(
            &root,
            "component:rgen",
            "variance",
            &format!(r#", "{declared_uri}""#),
        )
        .await?;
    if !declared.contains("true")
        || !declared.contains("kasset-variance")
        || !declared.contains("1600")
    {
        return Err(std::io::Error::other(format!("declared variance: {declared}")).into());
    }
    println!("local-reducer: declared variance -> {declared}");

    // The value proposition may carry the whole distribution curve; the adapter
    // validates it and uses its variance numerator as the engineering rate.
    let curve_stub = r#"new rs(`rho:registry:insertArbitrary`), uriCh,
    deployId(`rho:rchain:deployId`), KAsset in {
  contract KAsset(@"get", ret) = {
    ret!((true, {
      "id": "rho:id:local-kasset-curve",
      "quantity": {"unit": "m3", "value": 100},
      "quality": {"completeness": 3, "correctness": 3,
                  "traceability": 3, "fitness": 3},
      "variance": {
        "quantityBps": 400, "qualityBps": 1200, "n": 30,
        "curve": {
          "kind": "quantiles", "unit": "bpsOfDeclaredValue", "n": 16,
          "points": [0, 500, 1000, 1500, 2000, 2500, 3000, 3500,
                     4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500]
        }
      },
      "verdict": "valid",
      "status": "approved",
      "approval": {"decision": "approve",
                   "liability": {"responsible": "approver", "shareBps": 10000}}
    }))
  } |
  rs!(bundle+{*KAsset}, *uriCh) |
  for (@u <- uriCh) { deployId!([u]) }
}"#;
    let curve_reply = reducer.deploy(curve_stub).await?.join(" ");
    let curve_uri = find_uri(&curve_reply)
        .ok_or_else(|| std::io::Error::other(format!("curve stub: {curve_reply}")))?;
    let curve_read = reducer
        .component_call(
            &root,
            "component:rgen",
            "variance",
            &format!(r#", "{curve_uri}""#),
        )
        .await?;
    if !curve_read.contains("kasset-curve") || !curve_read.contains("\"curveStats\"") {
        return Err(std::io::Error::other(format!("curve variance: {curve_read}")).into());
    }
    println!("local-reducer: curve variance -> {curve_read}");

    let risk_req = format!(
        r#", *dId, {{"class": "property", "assetRef": {{"kind": "site", "hash": "asset:local", "uri": "{kasset_uri}"}}, "evidence": [{{"kind": "rgen:kasset", "uri": "{kasset_uri}", "hash": "kasset:local"}}], "triTest": {{"exposureRef": "exposure:local", "probabilityBasis": "claims-history", "consequenceBasis": "declared-value", "consequenceRef": "consequence:local"}}, "periodStart": 0, "periodEnd": 1000000, "declaredValue": 5000, "requestedLimit": 1000, "requestedDeductible": 0}}"#
    );
    let risk_reply = reducer
        .component_call(&root, "component:risk-book", "submit", &risk_req)
        .await?;
    let risk_uri = find_uri(&risk_reply)
        .ok_or_else(|| std::io::Error::other(format!("risk submit: {risk_reply}")))?;
    println!("local-reducer: variance risk {risk_uri}");

    let assessed = reducer
        .uri_call(
            &risk_uri,
            "assess",
            r#", *dId, {"expectedLoss": 800, "varianceBps": 5000, "quotedPremium": 1200, "loadBps": 2000, "basisHash": "underwriting:local", "toleranceBps": 1000}"#,
        )
        .await?;
    if !assessed.contains("true") {
        return Err(std::io::Error::other(format!("assess variance risk: {assessed}")).into());
    }
    let variance = reducer.uri_call(&risk_uri, "variance", "").await?;
    if !variance.contains("4000") || !variance.contains("1000") {
        return Err(std::io::Error::other(format!("risk variance: {variance}")).into());
    }
    println!("local-reducer: risk variance -> {variance}");

    let accepted = reducer.uri_call(&risk_uri, "accept", ", *dId").await?;
    if !accepted.contains("true") {
        return Err(std::io::Error::other(format!("accept variance risk: {accepted}")).into());
    }
    let acknowledged = reducer.uri_call(&risk_uri, "variance", "").await?;
    if !acknowledged.contains("acknowledged") || !acknowledged.contains("true") {
        return Err(std::io::Error::other(format!("acknowledged: {acknowledged}")).into());
    }
    println!("local-reducer: variance acknowledged on accept");

    let signal = reducer
        .component_call(
            &root,
            "component:variance-signal-book",
            "register",
            &format!(r#", "{risk_uri}""#),
        )
        .await?;
    if !signal.contains("true") || !signal.contains("rsk:") {
        return Err(std::io::Error::other(format!("signal register: {signal}")).into());
    }
    println!("local-reducer: variance signal -> {signal}");
    let summary = reducer
        .component_call(&root, "component:variance-signal-book", "summary", "")
        .await?;
    if !summary.contains("\"count\" : 1") || !summary.contains("\"positive\" : 1") {
        return Err(std::io::Error::other(format!("signal summary: {summary}")).into());
    }
    println!("local-reducer: variance signal summary -> {summary}");
    let duplicate = reducer
        .component_call(
            &root,
            "component:variance-signal-book",
            "register",
            &format!(r#", "{risk_uri}""#),
        )
        .await?;
    if !duplicate.contains("duplicate") {
        return Err(std::io::Error::other(format!("signal duplicate: {duplicate}")).into());
    }
    println!("local-reducer: refused duplicate variance signal");

    let curve_risk_req = format!(
        r#", *dId, {{"class": "property", "assetRef": {{"kind": "site", "hash": "asset:curve", "uri": "{curve_uri}"}}, "evidence": [{{"kind": "rgen:kasset", "uri": "{curve_uri}", "hash": "kasset:curve"}}], "triTest": {{"exposureRef": "exposure:curve", "probabilityBasis": "claims-history", "consequenceBasis": "declared-value", "consequenceRef": "consequence:curve"}}, "periodStart": 0, "periodEnd": 1000000, "declaredValue": 5000, "requestedLimit": 1000, "requestedDeductible": 0}}"#
    );
    let curve_risk_reply = reducer
        .component_call(&root, "component:risk-book", "submit", &curve_risk_req)
        .await?;
    let curve_risk_uri = find_uri(&curve_risk_reply)
        .ok_or_else(|| std::io::Error::other(format!("curve risk submit: {curve_risk_reply}")))?;
    println!("local-reducer: curve risk {curve_risk_uri}");

    let curve_assessed = reducer
        .uri_call(
            &curve_risk_uri,
            "assess",
            r#", *dId, {"expectedLoss": 800, "quotedPremium": 1200, "loadBps": 2000, "basisHash": "underwriting:curve", "toleranceBps": 1000, "shapeToleranceBps": 1000, "lossCurve": {"kind": "quantiles", "unit": "bpsOfDeclaredValue", "n": 16, "points": [2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000]}}"#,
        )
        .await?;
    if !curve_assessed.contains("true") {
        return Err(std::io::Error::other(format!("assess curve risk: {curve_assessed}")).into());
    }
    let curve_variance = reducer.uri_call(&curve_risk_uri, "variance", "").await?;
    for needle in [
        "\"curveSource\" : \"curve-curve\"",
        "\"curveFlagged\" : false",
        "\"relativeVarianceGapBps\" : 0",
        "\"rateFlagged\" : true",
        "\"pricingBps\" : 1360",
    ] {
        if !curve_variance.contains(needle) {
            return Err(std::io::Error::other(format!(
                "curve variance missing {needle}: {curve_variance}"
            ))
            .into());
        }
    }
    println!("local-reducer: curve risk variance -> {curve_variance}");
    let curve_accepted = reducer.uri_call(&curve_risk_uri, "accept", ", *dId").await?;
    if !curve_accepted.contains("true") {
        return Err(std::io::Error::other(format!("accept curve risk: {curve_accepted}")).into());
    }
    let curve_signal = reducer
        .component_call(
            &root,
            "component:variance-signal-book",
            "register",
            &format!(r#", "{curve_risk_uri}""#),
        )
        .await?;
    if !curve_signal.contains("true") {
        return Err(std::io::Error::other(format!("curve signal: {curve_signal}")).into());
    }
    let curve_summary = reducer
        .component_call(&root, "component:variance-signal-book", "summary", "")
        .await?;
    if !curve_summary.contains("\"count\" : 2")
        || !curve_summary.contains("\"negative\" : 1")
        || !curve_summary.contains("\"curveFlagged\" : 0")
    {
        return Err(std::io::Error::other(format!("curve summary: {curve_summary}")).into());
    }
    println!("local-reducer: curve signal summary -> {curve_summary}");

    let bad_assess = reducer
        .component_call(&root, "component:risk-book", "submit", &risk_req)
        .await?;
    let bad_uri = find_uri(&bad_assess)
        .ok_or_else(|| std::io::Error::other(format!("second risk: {bad_assess}")))?;
    let too_high = reducer
        .uri_call(
            &bad_uri,
            "assess",
            r#", *dId, {"expectedLoss": 800, "varianceBps": 10001, "quotedPremium": 1200, "loadBps": 2000, "basisHash": "underwriting:local"}"#,
        )
        .await?;
    expect_refusal("variance above range", &too_high, "assessment")?;
    let low_premium = reducer
        .uri_call(
            &bad_uri,
            "assess",
            r#", *dId, {"expectedLoss": 800, "varianceBps": 5000, "quotedPremium": 1, "loadBps": 2000, "basisHash": "underwriting:local"}"#,
        )
        .await?;
    expect_refusal("premium below floor", &low_premium, "premium floor")?;
    let keys = reducer.deploy(&keys).await?.join(" ");
    let registered = keys.matches("component:").count();
    if !keys.contains("true") || registered != 22 {
        return Err(std::io::Error::other(format!(
            "root keys: expected 22 components, got {registered}: {keys}"
        ))
        .into());
    }
    println!("local-reducer: root keys -> {registered} components");
    Ok(())
}

fn main() -> Result<(), Error> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run())
}
