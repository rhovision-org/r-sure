import RSure.Basic

/-!
Variance is risk.

A K-Asset's value is a random variable `V`. The insurer's loss is a deterministic
transform of it; the variance of the value and the variance of the loss are the same
property. The on-chain measure is the dimensionless variance rate
`Var(V) / mean(V)^2` in basis points, which is scale-free and lets r-sure compare an
engineering estimate (from the K-Asset's quality, verdict and liability) with an
insurer's estimate.

The model is exact integer arithmetic over equally likely outcomes. `ssNum` is
`sum (W*v - S)^2`, where `W` is the outcome count and `S` the sum of values. It equals
`W^3 * Var(V)` without division, so the identity proofs stay in `Int`.
-/

namespace RSure.Model.Variance

open RSure

/-- Outcome count as an `Int`. -/
def wlen : List Int → Int
  | [] => 0
  | _ :: xs => 1 + wlen xs

/-- Sum of the outcomes. -/
def total : List Int → Int
  | [] => 0
  | v :: vs => v + total vs

/-- `sum (w*v - s)^2` over the outcomes. -/
def ssAux (w s : Int) : List Int → Int
  | [] => 0
  | v :: vs => (w * v - s) * (w * v - s) + ssAux w s vs

/-- The unnormalised variance numerator `W^3 * Var(V)`. -/
def ssNum (xs : List Int) : Int := ssAux (wlen xs) (total xs) xs

/-- Variance rate in basis points: `Var(V) / mean(V)^2 * 10000`, floored. -/
def rateBps (xs : List Int) : Int :=
  let s := total xs
  if s ≤ 0 then 0 else ssNum xs * 10000 / (wlen xs * s * s)

theorem int_mul_self_nonneg (a : Int) : 0 ≤ a * a := by
  rw [← Int.natAbs_mul_self (a := a)]
  exact Int.ofNat_nonneg _

theorem wlen_nonneg (xs : List Int) : 0 ≤ wlen xs := by
  induction xs with
  | nil => simp [wlen]
  | cons v vs ih => simp [wlen]; omega

@[simp] theorem wlen_map_add (xs : List Int) (c : Int) :
    wlen (xs.map (fun v => v + c)) = wlen xs := by
  induction xs with
  | nil => rfl
  | cons _ vs ih => simp [wlen, ih]

theorem total_map_add (xs : List Int) (c : Int) :
    total (xs.map (fun v => v + c)) = total xs + wlen xs * c := by
  induction xs with
  | nil => simp [total, wlen]
  | cons v vs ih =>
      simp only [List.map_cons, total, wlen]
      rw [ih, Int.add_mul, Int.one_mul]
      omega

theorem ssAux_shift (w s c : Int) (xs : List Int) :
    ssAux w (s + w * c) (xs.map (fun v => v + c)) = ssAux w s xs := by
  induction xs with
  | nil => rfl
  | cons v vs ih =>
      simp only [List.map_cons, ssAux]
      have h : w * (v + c) - (s + w * c) = w * v - s := by
        rw [Int.mul_add]
        omega
      rw [h, ih]

/-- Shifting the values leaves the variance unchanged. -/
theorem ssNum_shift (xs : List Int) (c : Int) :
    ssNum (xs.map (fun v => v + c)) = ssNum xs := by
  unfold ssNum
  rw [wlen_map_add, total_map_add]
  exact ssAux_shift _ _ _ _

@[simp] theorem wlen_map_reflect (xs : List Int) (c : Int) :
    wlen (xs.map (fun v => c - v)) = wlen xs := by
  induction xs with
  | nil => rfl
  | cons _ vs ih => simp [wlen, ih]

theorem total_map_reflect (xs : List Int) (c : Int) :
    total (xs.map (fun v => c - v)) = wlen xs * c - total xs := by
  induction xs with
  | nil => simp [total, wlen]
  | cons v vs ih =>
      simp only [List.map_cons, total, wlen]
      rw [ih, Int.add_mul, Int.one_mul]
      omega

theorem ssAux_reflect (w s c : Int) (xs : List Int) :
    ssAux w (w * c - s) (xs.map (fun v => c - v)) = ssAux w s xs := by
  induction xs with
  | nil => rfl
  | cons v vs ih =>
      simp only [List.map_cons, ssAux]
      have h : w * (c - v) - (w * c - s) = -(w * v - s) := by
        rw [Int.mul_sub]
        omega
      rw [h, Int.neg_mul_neg, ih]

/-- Reflecting the values around a constant leaves the variance unchanged. A full
    indemnity `L = C - V` therefore has the same variance as the K-Asset value. -/
theorem ssNum_reflect (xs : List Int) (c : Int) :
    ssNum (xs.map (fun v => c - v)) = ssNum xs := by
  unfold ssNum
  rw [wlen_map_reflect, total_map_reflect]
  exact ssAux_reflect _ _ _ _

/-- A full indemnity has the same variance as the K-Asset value. -/
theorem risk_is_variance (xs : List Int) (c : Int) :
    ssNum (xs.map (fun v => c - v)) = ssNum xs :=
  ssNum_reflect xs c

theorem ssAux_nonneg (w s : Int) (xs : List Int) : 0 ≤ ssAux w s xs := by
  induction xs with
  | nil => simp [ssAux]
  | cons v vs ih =>
      simp only [ssAux]
      exact Int.add_nonneg (int_mul_self_nonneg _) ih

theorem ssNum_nonneg (xs : List Int) : 0 ≤ ssNum xs := by
  unfold ssNum
  exact ssAux_nonneg _ _ _

/-- The fitted rate is non-negative (the denominator is guarded by `s ≤ 0`). -/
theorem rateBps_nonneg (xs : List Int) : 0 ≤ rateBps xs := by
  unfold rateBps
  by_cases h : total xs ≤ 0
  · simp [h]
  · have hs : 0 < total xs := by omega
    have hw : 0 < wlen xs := by
      cases xs with
      | nil => simp [total] at hs
      | cons _ vs => simp [wlen]; have := wlen_nonneg vs; omega
    have hden : 0 ≤ wlen xs * total xs * total xs := by
      apply Int.mul_nonneg
      · exact Int.mul_nonneg (by omega) (by omega)
      · omega
    have hnum : 0 ≤ ssNum xs * 10000 :=
      Int.mul_nonneg (ssNum_nonneg xs) (by decide)
    simpa [h] using Int.ediv_nonneg hnum hden


theorem nat_div_le_div_right {a b c : Nat} (h : a ≤ b) : a / c ≤ b / c := by
  cases c with
  | zero => simp
  | succ c =>
      rw [Nat.le_div_iff_mul_le (Nat.succ_pos c)]
      exact Nat.le_trans (Nat.div_mul_le_self a (c + 1)) h

/-! Engineering estimate and the insurer's gap. -/

/-- Engineering variance rate from the K-Asset conventions. `qualitySum` is the four
    1..5 rubric dimensions; `isPartial` covers a partial verdict. The approver's
    `liability.shareBps` is a declared indemnity share, not a variance signal, so it is
    not part of this measure. -/
def qualityVariance (qualitySum : Nat) (isPartial : Bool) : Nat :=
  let deficit := 20 - qualitySum
  let verdict := if isPartial then 1000 else 0
  deficit * 500 + verdict

theorem qualityVariance_le (qualitySum : Nat) (isPartial : Bool)
    (hq : qualitySum ≤ 20) (hq4 : 4 ≤ qualitySum) :
    qualityVariance qualitySum isPartial ≤ 9000 := by
  have hd : 20 - qualitySum ≤ 16 := by omega
  dsimp only [qualityVariance]
  split <;> omega

def qualityVarianceOption (qualitySum : Nat) (isPartial : Bool) : Option Nat :=
  if qualitySum < 4 || qualitySum > 20 then none
  else some (qualityVariance qualitySum isPartial)

theorem variance_refuses_bad_input (isPartial : Bool) :
    qualityVarianceOption 3 isPartial = none := by
  simp [qualityVarianceOption]

theorem variance_reachable : qualityVarianceOption 20 false = some 0 := by
  simp [qualityVarianceOption, qualityVariance]

/-- The declared rate from a value proposition snapshot: the quantity and quality
    second moments in bps. r-gen bounds each branch and their sum to 10000 bps, so the
    declared rate is always inside the same bound as the derived one. -/
def declaredVariance (quantityBps qualityBps : Nat) : Option Nat :=
  if quantityBps + qualityBps > 10000 then none
  else some (quantityBps + qualityBps)

theorem declaredVariance_le_10000 {q b v : Nat}
    (h : declaredVariance q b = some v) : v ≤ 10000 := by
  unfold declaredVariance at h
  split at h
  · simp at h
  · simp at h
    omega

theorem declaredVariance_refuses_overflow : declaredVariance 6000 6000 = none := by
  simp [declaredVariance]

/-- The cross-repo golden fixture: quantity 4% and quality 12% declare 1600 bps. -/
theorem declaredVariance_fixture : declaredVariance 400 1200 = some 1600 := by
  simp [declaredVariance]

theorem qualityVariance_mono {q1 q2 : Nat} (h : q1 ≤ q2) (h2 : q2 ≤ 20)
    (isPartial : Bool) :
    qualityVariance q2 isPartial ≤ qualityVariance q1 isPartial := by
  have hd : 20 - q2 ≤ 20 - q1 := by omega
  dsimp only [qualityVariance]
  split <;> omega

/-- Variance-principle load: expected loss plus a share of the variance rate. At
    `varianceBps = loadBps = 10000` the load is 100% of the expected loss. -/
def loadedPremium (expectedLoss varianceBps loadBps : Nat) : Nat :=
  expectedLoss
    + expectedLoss * varianceBps * loadBps / (BPS * BPS)

theorem loadedPremium_ge_expected (expectedLoss varianceBps loadBps : Nat) :
    expectedLoss ≤ loadedPremium expectedLoss varianceBps loadBps := by
  unfold loadedPremium
  have hd : 0 ≤ expectedLoss * varianceBps * loadBps / (BPS * BPS) := Nat.zero_le _
  omega

theorem loadedPremium_mono_variance {v1 v2 : Nat} (h : v1 ≤ v2)
    (expectedLoss loadBps : Nat) :
    loadedPremium expectedLoss v1 loadBps ≤ loadedPremium expectedLoss v2 loadBps := by
  unfold loadedPremium
  have hm : expectedLoss * v1 * loadBps ≤ expectedLoss * v2 * loadBps := by
    exact Nat.mul_le_mul_right loadBps (Nat.mul_le_mul_left expectedLoss h)
  have hd := nat_div_le_div_right (c := BPS * BPS) hm
  omega

theorem loadedPremium_zero (expectedLoss loadBps : Nat) :
    loadedPremium expectedLoss 0 loadBps = expectedLoss := by
  simp [loadedPremium]

/-! The visible gap between the engineering and insurer estimates. -/

def gapBps (engineering insurer : Nat) : Int :=
  (insurer : Int) - (engineering : Int)

def gapFlag (engineering insurer tolerance : Nat) : Bool :=
  tolerance < (gapBps engineering insurer).natAbs

/-- The flag means exactly that the absolute gap exceeds the tolerance. -/
theorem gapFlag_sound (engineering insurer tolerance : Nat) :
    gapFlag engineering insurer tolerance = true ↔
      tolerance < (gapBps engineering insurer).natAbs := by
  simp [gapFlag]

/-- The model-level soundness statement: the load never undercuts expected loss and the
    gap flag is exactly the tolerance comparison. The estimator and contract-guard facts
    are carried by the separate substantive theorems cited with this one. -/
theorem variance_sound (engineering insurer tolerance expectedLoss loadBps : Nat) :
    expectedLoss ≤ loadedPremium expectedLoss insurer loadBps ∧
      (gapFlag engineering insurer tolerance = true ↔
        tolerance < (gapBps engineering insurer).natAbs) := by
  exact ⟨loadedPremium_ge_expected expectedLoss insurer loadBps,
         gapFlag_sound engineering insurer tolerance⟩

end RSure.Model.Variance
