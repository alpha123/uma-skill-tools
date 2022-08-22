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
		if (this === other) {  // compare by identity since DistributionRandomPolicy subclasses are cached by their parameters
			return this;
		}
		throw new Error('cannot reconcile different distributions');
	}
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
		let nums = [], min = Infinity, max = 0.0;
		const halfn = Math.ceil(nsamples / 2);
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
			min = Math.min(min, a, b);
			max = Math.max(max, a, b);
			nums.push(a,b);
		}
		const range = max - min;
		return nums.map(n => Math.floor(upper * (n - min) / range));
	}
}

export class ErlangRandomPolicy extends DistributionRandomPolicy {
	constructor(readonly k: number, readonly lambda: number) { super(); }

	distribution(upper: number, nsamples: number, rng: PRNG) {
		const nums = [];
		let min = Infinity, max = 0.0;
		for (let i = 0; i < nsamples; ++i) {
			let u = 1.0;
			for (let j = 0; j < this.k; ++j) {
				u *= rng.random();
			}
			const n = -Math.log(u) / this.lambda;
			min = Math.min(min, n);
			max = Math.max(max, n);
			nums.push(n);
		}
		// somewhat terrible hack
		// the problem is that if nsamples == 1 then max == min and range is 0, and we divide by range
		// the other problem is that an erlang distribution has support [0,∞), so there's no sensible upper bound
		// (i think this makes the entire normalization procedure somewhat suspect, but it seems to work ok)
		// in practice the generated range depends on choices for k and lambda, and not in a way that i really understand well enough to try to
		// guess an upper bound here.
		// so after trying it with a few choices of parameters that are used for modeling skill conditions, somewhat arbitrarily decide on 18.
		// this isn't so bad as one might first expect, since really the only time 1 sample is requested is for plotting, and it doesn't really
		// matter if that actually obeys the distribution or not.
		// note that this isn't really a problem for LogNormalRandomPolicy since it always generates at least two numbers. granted, that will
		// probably result in some fairly odd results, but that's not really a big deal.
		const range = nsamples == 1 ? 18 : max - min;
		return nums.map(n => Math.floor(upper * (n - min) / range));
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
