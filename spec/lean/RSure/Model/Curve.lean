import RSure.Model.Variance

/-!
Risk curves.

A K-Asset's value and an actuary's loss price are both distributions. The on-chain
representation is a 16-point curve in basis points of the declared value. The variance
numerator is the same property as `RSure.Model.Variance.ssNum`; a full-indemnity reflection
leaves it unchanged. The curve delta is a signal, not a consensus: the relative variance gap
compares the numerators, and the shape metrics are a mirrored L1 distance.

This is a shallow integer model, not a refinement of the Rholang terms.
-/

namespace RSure.Model.Curve

open RSure
open RSure.Model.Variance

/-- Centre a curve: `16*p_i - sum`. The variance numerator is the sum of squares of this. -/
def scaled (xs : List Int) : List Int :=
  let s := total xs
  xs.map (fun p => 16 * p - s)

/-- The full-indemnity reflection around the declared-value scale. -/
def reflect (xs : List Int) : List Int :=
  xs.map (fun p => 10000 - p)

def absInt (x : Int) : Int :=
  if x < 0 then -x else x

theorem absInt_nonneg (x : Int) : 0 ≤ absInt x := by
  unfold absInt
  split <;> omega

/-- Sum of absolute differences of two lists. -/
def l1Minus : List Int → List Int → Int
  | [], _ => 0
  | _, [] => 0
  | x :: xs, y :: ys => absInt (x - y) + l1Minus xs ys

/-- Sum of absolute sums; used for the mirrored alignment. -/
def l1Plus : List Int → List Int → Int
  | [], _ => 0
  | _, [] => 0
  | x :: xs, y :: ys => absInt (x + y) + l1Plus xs ys

def l1Forward (a b : List Int) : Int :=
  l1Minus (scaled a) (scaled b)

def l1Mirror (a b : List Int) : Int :=
  l1Plus (scaled a) (scaled b.reverse)

def l1Num (a b : List Int) : Int :=
  min (l1Forward a b) (l1Mirror a b)

def maxDev : List Int → Int
  | [] => 0
  | x :: xs =>
      let rest := maxDev xs
      if absInt x > rest then absInt x else rest

/-- The signed relative variance gap. Positive means the second curve has more variance. -/
def relativeVarianceGap (a b : List Int) : Int :=
  if ssNum a = 0 then 0 else (ssNum b - ssNum a) * 10000 / ssNum a

theorem l1Minus_nonneg : ∀ xs ys, 0 ≤ l1Minus xs ys
  | [], _ => by simp [l1Minus]
  | _ :: _, [] => by simp [l1Minus]
  | x :: xs, y :: ys => by
      simp [l1Minus]
      exact Int.add_nonneg (absInt_nonneg (x - y)) (l1Minus_nonneg xs ys)

theorem l1Plus_nonneg : ∀ xs ys, 0 ≤ l1Plus xs ys
  | [], _ => by simp [l1Plus]
  | _ :: _, [] => by simp [l1Plus]
  | x :: xs, y :: ys => by
      simp [l1Plus]
      exact Int.add_nonneg (absInt_nonneg (x + y)) (l1Plus_nonneg xs ys)

theorem maxDev_nonneg : ∀ xs, 0 ≤ maxDev xs
  | [] => by simp [maxDev]
  | x :: xs => by
      simp [maxDev]
      split
      · exact absInt_nonneg x
      · exact maxDev_nonneg xs

/-- A reflection leaves the variance numerator unchanged. -/
theorem ssNum_reflect_curve (xs : List Int) : ssNum (reflect xs) = ssNum xs := by
  unfold reflect
  exact ssNum_reflect xs 10000

/-- The relative variance gap is zero for a full-indemnity reflection. -/
theorem relativeVarianceGap_reflect (a : List Int) :
    relativeVarianceGap a (reflect a) = 0 := by
  unfold relativeVarianceGap
  rw [ssNum_reflect_curve]
  split <;> simp

/-- A common constant shift leaves the variance numerator unchanged. -/
theorem ssNum_shift_curve (a : List Int) (c : Int) :
    ssNum (a.map (fun p => p + c)) = ssNum a :=
  ssNum_shift a c

/-- The relative variance gap is zero for a common shift. -/
theorem relativeVarianceGap_shift (a : List Int) (c : Int) :
    relativeVarianceGap a (a.map (fun p => p + c)) = 0 := by
  unfold relativeVarianceGap
  rw [ssNum_shift_curve]
  split <;> simp

/-- A signal replacement is versioned by the Risk nonce. -/
inductive SignalPut where
  | duplicate
  | stale
  | replace

def signalPut (old new : Nat) : SignalPut :=
  if new = old then .duplicate
  else if new < old then .stale
  else .replace

theorem signalPut_same (n : Nat) : signalPut n n = .duplicate := by
  simp [signalPut]

theorem signalPut_stale {old new : Nat} (h : new < old) :
    signalPut old new = .stale := by
  have hne : new ≠ old := Nat.ne_of_lt h
  simp [signalPut, hne, h]

theorem signalPut_replace {old new : Nat} (h : old < new) :
    signalPut old new = .replace := by
  have hne : new ≠ old := Nat.ne_of_gt h
  have hnot : ¬ new < old := Nat.not_lt.mpr (Nat.le_of_lt h)
  simp [signalPut, hne, hnot]

end RSure.Model.Curve
