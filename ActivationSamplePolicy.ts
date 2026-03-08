import { Region, RegionList } from './Region';
import { PRNG } from './Random';

export interface ActivationSamplePolicy {
	sample(regions: RegionList, nsamples: number, rng: PRNG): Region[]

	// essentially, when two conditions are combined with an AndOperator one should take precedence over the other
	// immediate transitions into anything and straight_random/all_corner_random dominate everything except each other
	// NB. currently there are no skills that combine straight_random or all_corner_random with anything other than
	// immediate conditions (running_style or distance_type), and obviously they are mutually exclusive with each other
	// the actual x_random (phase_random, down_slope_random, etc) ones should dominate the ones that are not actually
	// random but merely modeled with a probability distribution
	// use smalltalk-style double dispatch to implement the transitions
	reconcile(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileImmediate(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileDistributionRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileStraightRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileAllCornerRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
}

export const ImmediatePolicy = Object.freeze({
	sample(regions: RegionList, _0: number, _1: PRNG) { return regions.slice(0,1); },
	reconcile(other: ActivationSamplePolicy) { return other.reconcileImmediate(this); },
	reconcileImmediate(other: ActivationSamplePolicy) { return other; },
	reconcileDistributionRandom(other: ActivationSamplePolicy) { return other; },
	reconcileRandom(other: ActivationSamplePolicy) { return other; },
	reconcileStraightRandom(other: ActivationSamplePolicy) { return other; },
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { return other; }
});

export const RandomPolicy = Object.freeze({
	sample(regions: RegionList, nsamples: number, rng: PRNG) {
		if (regions.length == 0) {
			return [];
		}
		let acc = 0;
		const weights = regions.map(r => acc += r.end - r.start);
		const samples = [];
		for (let i = 0; i < nsamples; ++i) {
			const threshold = rng.uniform(acc);
			const region = regions.find((_,i) => weights[i] > threshold)!;
			samples.push(region.start + rng.uniform(region.end - region.start - 10));
		}
		return samples.map(pos => new Region(pos, pos + 10));
	},
	reconcile(other: ActivationSamplePolicy) { return other.reconcileRandom(this); },
	reconcileImmediate(_: ActivationSamplePolicy) { return this; },
	reconcileDistributionRandom(other: ActivationSamplePolicy) { return this; },
	reconcileRandom(other: ActivationSamplePolicy) { return other; },
	reconcileStraightRandom(other: ActivationSamplePolicy) { return other; },
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { return other; }
});

export abstract class DistributionRandomPolicy {
	abstract distribution(upper: number, nsamples: number, rng: PRNG): number[]

	sample(regions: RegionList, nsamples: number, rng: PRNG) {
		if (regions.length == 0) {
			return [];
		}
		const range = regions.reduce((acc,r) => acc + r.end - r.start, 0);
		const rs = regions.slice().sort((a,b) => a.start - b.start);
		const randoms = this.distribution(range, nsamples, rng);
		const samples = [];
		for (let i = 0; i < nsamples; ++i) {
			let pos = randoms[i];
			for (let j = 0;; j++) {
				pos += rs[j].start;
				if (pos > rs[j].end) {
					pos -= rs[j].end;
				} else {
					samples.push(new Region(pos, rs[j].end));
					break;
				}
			}
		}
		return samples;
	}

	reconcile(other: ActivationSamplePolicy) { return other.reconcileDistributionRandom(this); }
	reconcileImmediate(_: ActivationSamplePolicy) { return this; }
	reconcileDistributionRandom(other: ActivationSamplePolicy) {
		// this is, strictly speaking, probably not the right thing to do
		// probably this should be the joint probability distribution of `this` and `other`, but that is too complex to implement
		// TODO this is something of a stopgap measure anyway, since eventually we'd like to model most of the conditions that use
		// DistributionRandomPolicy with dynamic conditions using a Poisson process or something, which would make this obsolete
		// (this would also enable other features like cooldowns for distribution-random skills).
		return this;
	}
	// this is probably not exactly the right thing to do either, but the true random conditions do need to place a fixed trigger
	// statically ahead of time, uninfluenced by us. this means that the only alternatives are 1) this condition is coincidentally
	// fulfilled during the static random trigger or 2) the skill does not activate at all.
	// since the latter is not particularly interesting, it's safe to just ignore this sample policy and use only the true random one.
	reconcileRandom(other: ActivationSamplePolicy) { return other; }
	reconcileStraightRandom(other: ActivationSamplePolicy) { return other; }
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { return other; }
}

export class UniformRandomPolicy extends DistributionRandomPolicy {
	constructor() { super(); }

	distribution(upper: number, nsamples: number, rng: PRNG) {
		const nums = [];
		for (let i = 0; i < nsamples; ++i) {
			nums.push(rng.uniform(upper));
		}
		return nums;
	}
}

export class LogNormalRandomPolicy extends DistributionRandomPolicy {
	constructor(readonly mu: number, readonly sigma: number) { super(); }

	distribution(upper: number, nsamples: number, rng: PRNG) {
		// see <https://en.wikipedia.org/wiki/Box%E2%80%93Muller_transform>
		const nums = [], halfn = Math.ceil(nsamples / 2);
		for (let i = 0; i < halfn; ++i) {
			let x, y, r2;
			do {
				x = rng.random() * 2.0 - 1.0;
				y = rng.random() * 2.0 - 1.0;
				r2 = x * x + y * y;
			} while (r2 == 0.0 || r2 >= 1.0);
			const m = Math.sqrt(-2.0 * Math.log(r2) / r2) * this.sigma;
			const a = Math.exp(x * m + this.mu);
			const b = Math.exp(y * m + this.mu);
			nums.push(a,b);
		}
		// this is one of the more mathematically suspect parts of the whole endeavour. essentially we have a bunch of numbers `nums` in (0,+∞).
		// what we want is a bunch of numbers in [0,upper] with essentially the same skewness, excess kurtosis, etc as `nums`. the obvious way to do
		// that is to normalize nums to [0,1] and multiply that by `upper`. formerly we normalized to the observed min and max, but particularly
		// when `nsamples` is small this is not great. instead we estimate the 0.1th percentile and 99.9th percentile of values that we are likely
		// to see for a given μ and σ, and normalize to that. i am not completely sure that this is a reasonable thing to do.
		// 
		// i feel like there should be some way to do this directly and avoid this step while being more theoretically sound, but i haven't thought
		// of it yet.
		// 
		// the reason we have to do the scaling like this is because `upper` isn't known at the time the parameters are chosen, so we can't pick ones
		// that naturally go from 0 to ~upper.
		// 
		// the dumb part about this is that it makes μ meaningless obviously.

		// inverse CDF is e^(μ + σ√2 · erf⁻¹(2p - 1))
		// constants obtained via Mathematica `InverseErf[2 * 0.999 - 1] * Sqrt[2]`
		const min = Math.exp(this.mu + this.sigma * -3.09023), max = Math.exp(this.mu + this.sigma * 3.09023);
		const range = max - min;
		return nums.map(n => Math.floor(upper * Math.min(Math.max(n - min, 0) / range, 1.0)));
	}
}

export class ErlangRandomPolicy extends DistributionRandomPolicy {
	constructor(readonly k: number, readonly lambda: number) { super(); }

	distribution(upper: number, nsamples: number, rng: PRNG) {
		const nums = [];
		for (let i = 0; i < nsamples; ++i) {
			let u = 1.0;
			for (let j = 0; j < this.k; ++j) {
				u *= rng.random();
			}
			const n = -Math.log(u) / this.lambda;
			nums.push(n);
		}
		// the comment in LogNormalRandomPolicy#distribution applies here as well, but much worse. there is no closed-form inverse CDF for an Erlang
		// distribution, so (and surely there's a better way to do this) we just pretend it's a chi-squared distribution with 2k and then use the
		// Wilson-Hilferty transformation to approximate it as a normal distribution. yes, this is pretty awful. in practice the approximation is
		// surprisingly okay, though i don't really feel good about this. im also not at all sure i didnt make some mistakes in the math, but testing
		// it numerically its remarkably close.
		// as with μ above, λ controls the scale of the distribution but we rescale everything anyway, so it is completely irrelevant.
		const min = this.k * Math.pow(1 - 1/(9*this.k) + -3.09023 * Math.sqrt(1/(9*this.k)), 3) / this.lambda,
			max = this.k * Math.pow(1 - 1/(9*this.k) + 3.09023 * Math.sqrt(1/(9*this.k)), 3) / this.lambda;
		const range = max - min;
		return nums.map(n => Math.floor(upper * Math.min(Math.max(n - min, 0) / range, 1.0)));
	}
}

export const StraightRandomPolicy = Object.freeze({
	sample(regions: RegionList, nsamples: number, rng: PRNG) {
		// regular RandomPolicy weights regions by their length, so any given point has an equal chance to be chosen across all regions
		// StraightRandomPolicy first picks a region with equal chance regardless of length, and then picks a random point on that region
		if (regions.length == 0) {
			return [];
		}
		const samples = [];
		for (let i = 0; i < nsamples; ++i) {
			const r = regions[rng.uniform(regions.length)];
			samples.push(r.start + rng.uniform(r.end - r.start - 10));
		}
		return samples.map(pos => new Region(pos, pos + 10));
	},
	reconcile(other: ActivationSamplePolicy) { return other.reconcileStraightRandom(this); },
	reconcileImmediate(_: ActivationSamplePolicy) { return this; },
	reconcileDistributionRandom(_: ActivationSamplePolicy) { return this; },
	reconcileRandom(_: ActivationSamplePolicy) { return this; },
	reconcileStraightRandom(other: ActivationSamplePolicy) { return other; },
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { throw new Error('cannot reconcile StraightRandomPolicy with AllCornerRandomPolicy'); }
});

export const AllCornerRandomPolicy = Object.freeze({
	placeTriggers(regions: RegionList, rng: PRNG) {
		const triggers = [];
		const candidates = regions.slice();
		candidates.sort((a,b) => a.start - b.start);
		while (triggers.length < 4 && candidates.length > 0) {
			const ci = rng.uniform(candidates.length);
			const c = candidates[ci];
			const start = c.start + rng.uniform(c.end - c.start - 10);
			// note that as each corner's end cannot come after the start of the next corner, this maintains that the candidates
			// are sorted by start
			if (start + 20 <= c.end) {
				candidates.splice(ci, 1, new Region(start + 10, c.end));
			} else {
				candidates.splice(ci, 1);
			}
			candidates.splice(0, ci);  // everything before this corner in the array is guaranteed to be before it in distance
			triggers.push(start);
		}
		// TODO support multiple triggers for skills with cooldown
		return new Region(triggers[0], triggers[0] + 10);  // guaranteed to be the earliest trigger since each trigger is placed after the last one
	},
	sample(regions: RegionList, nsamples: number, rng: PRNG) {
		const samples = [];
		for (let i = 0; i < nsamples; ++i) {
			samples.push(this.placeTriggers(regions, rng));
		}
		return samples;
	},
	reconcile(other: ActivationSamplePolicy) { return other.reconcileAllCornerRandom(this); },
	reconcileImmediate(_: ActivationSamplePolicy) { return this; },
	reconcileDistributionRandom(_: ActivationSamplePolicy) { return this; },
	reconcileRandom(_: ActivationSamplePolicy) { return this; },
	reconcileStraightRandom(_: ActivationSamplePolicy) { throw new Error('cannot reconcile StraightRandomPolicy with AllCornerRandomPolicy'); },
	reconcileAllCornerRandom(_: ActivationSamplePolicy) { return this; }
});
