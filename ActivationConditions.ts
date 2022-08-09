const assert = require('assert').strict;

import { CourseData, CourseHelpers, Phase } from './CourseData';
import { HorseParameters, StrategyHelpers } from './HorseTypes';
import { RaceState, DynamicCondition } from './RaceSolver';

// half-open interval [start,end)
export class Region {
	constructor(readonly start: number, readonly end: number) {}

	intersect(other: {start: number, end: number}) {
		const start = Math.max(this.start, other.start);
		const end = Math.min(this.end, other.end);
		if (end <= start) {
			return new Region(-1, -1);
		} else {
			return new Region(start, end);
		}
	}

	fullyContains(other: {start: number, end: number}) {
		return this.start <= other.start && this.end >= other.end;
	}
}

export class RegionList extends Array<Region> {
	rmap(f: (r: Region) => Region | Region[]) {
		const out = new RegionList();
		this.forEach(r => {
			const newr = f(r);
			if (Array.isArray(newr)) {
				newr.forEach(nr => {
					if (nr.start > -1) {
						out.push(nr);
					}
				});
			}
			else if (newr.start > -1) {
				out.push(newr);
			}
		});
		return out;
	}

	union(other: RegionList) {
		const u: Region[] = [];
		const r = new RegionList();
		u.push.apply(u, this);
		u.push.apply(u, other);
		if (u.length == 0) {
			return r;
		}
		u.sort((a,b) => a.start - b.start);
		r.push(u.reduce((a,b) => {
			if (a.fullyContains(b)) {
				return a;
			} else if (a.start <= b.start && b.start < a.end) {
				return new Region(a.start, b.end);
			} else if (a.start < b.end && b.end <= a.end) {
				return new Region(b.start, a.end);
			} else {
				r.push(a);
				return b;
			}
		}));
		return r;
	}
}

// K as in SKI combinators
function kTrue(_: RaceState) {
	return true;
}

function withDefaultCond(r: RegionList | [RegionList, DynamicCondition]) {
	if (r instanceof RegionList) {
		return [r, kTrue] as [RegionList, DynamicCondition];
	}
	return r;
}

export interface Operator {
	samplePolicy: ActivationSamplePolicy
	apply(regions: RegionList, course: CourseData, horse: HorseParameters): [RegionList, DynamicCondition]
}

export interface CmpOperator extends Operator {
	condition: Condition
	argument: number
}

export class EqOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterEq(regions, this.argument, course, horse));
	}
}

export class NeqOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterNeq(regions, this.argument, course, horse));
	}
}

export class LtOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterLt(regions, this.argument, course, horse));
	}
}

export class LteOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterLte(regions, this.argument, course, horse));
	}
}

export class GtOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterGt(regions, this.argument, course, horse));
	}
}

export class GteOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterGte(regions, this.argument, course, horse));
	}
}

export class AndOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly left: Operator, readonly right: Operator) {
		this.samplePolicy = left.samplePolicy.reconcile(right.samplePolicy);
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		const [leftval, leftcond] = this.left.apply(regions, course, horse);
		const [rightval, rightcond] = this.right.apply(leftval, course, horse);
		if (leftcond === kTrue && rightcond === kTrue) {
			// avoid allocating an unnecessary closure object in the common case of no dynamic conditions
			return [rightval, kTrue] as [RegionList, DynamicCondition];
		}
		return [rightval, (s) => leftcond(s) && rightcond(s)] as [RegionList, DynamicCondition];
	}
}

export class OrOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly left: Operator, readonly right: Operator) {
		// not entirely clear what the right thing to do here is
		// but i'm pretty sure there are no skills with disjunctive conditions that
		// would have different sample policies (probably)
		this.samplePolicy = left.samplePolicy.reconcile(right.samplePolicy);
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		const [leftval, leftcond] = this.left.apply(regions, course, horse);
		const [rightval, rightcond] = this.right.apply(regions, course, horse);
		// FIXME this is, technically, completely broken. really the correct way to do this is to tie dynamic conditions to regions
		// and propagate them during union and intersection. however, that's really annoying, and it turns out in practice that
		// dynamic conditions never actually change between branches of an or operator if the static conditions differ, in which case
		// this works out just fine. specifically, it's fine if /either/ the dynamic conditions differ or the static conditions differ
		// between branches, but not both.
		// eg, consider something like phase==0&accumulatetime>=20@phase==1&accumulatetime>=30
		// suppose phase 0 lasts 21 seconds, in which case the left branch would not trigger. the right branch then should not trigger
		// until 30 seconds, but this obviously does because it's broken. conditions like this do not currently appear on any skills.
		// unfortunately, there's not really a way here to assert that leftcond and rightcond are the same.
		// this is rather risky. i don't like it.
		// TODO actually, it's perfectly possible to just inspect the tree to make sure the above limitations are satisfied.
		return [leftval.union(rightval), (s) => leftcond(s) || rightcond(s)] as [RegionList, DynamicCondition];
	}
}

export interface ActivationSamplePolicy {
	sample(regions: RegionList, nsamples: number): Region[]

	// essentially, when two conditions are combined with an AndOperator one should take precedence over the other
	// asap transitions into anything and straight_random/all_corner_random dominate everything except each other
	// NB. currently there are no skills that combine straight_random or all_corner_random with anything other than
	// immediate conditions (running_style or distance_type), and obviously they are mutually exclusive with each other
	// the actual x_random (phase_random, down_slope_random, etc) ones should dominate the ones that are not actually
	// random but merely modeled with a probability distribution
	// use smalltalk-style double dispatch to implement the transitions
	reconcile(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileAsap(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileDistributionRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileStraightRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileAllCornerRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
}

const AsapPolicy = Object.freeze({
	sample(regions: RegionList, _: number) { return regions.slice(0,1); },
	reconcile(other: ActivationSamplePolicy) { return other.reconcileAsap(this); },
	reconcileAsap(other: ActivationSamplePolicy) { return other; },
	reconcileDistributionRandom(other: ActivationSamplePolicy) { return other; },
	reconcileRandom(other: ActivationSamplePolicy) { return other; },
	reconcileStraightRandom(other: ActivationSamplePolicy) { return other; },
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { return other; }
});

const RandomPolicy = Object.freeze({
	sample(regions: RegionList, nsamples: number) {
		if (regions.length == 0) {
			return [];
		}
		let acc = 0;
		const weights = regions.map(r => acc += r.end - r.start);
		const samples = [];
		for (let i = 0; i < nsamples; ++i) {
			const threshold = Math.random() * acc;
			const region = regions.find((_,i) => weights[i] > threshold)!;
			samples.push(region.start + Math.floor(Math.random() * (region.end - region.start - 10)));
		}
		return samples.map(pos => new Region(pos, pos + 10));
	},
	reconcile(other: ActivationSamplePolicy) { return other.reconcileRandom(this); },
	reconcileAsap(_: ActivationSamplePolicy) { return this; },
	reconcileDistributionRandom(other: ActivationSamplePolicy) { return this; },
	reconcileRandom(other: ActivationSamplePolicy) { return other; },
	reconcileStraightRandom(other: ActivationSamplePolicy) { return other; },
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { return other; }
});

abstract class DistributionRandomPolicy {
	abstract distribution(n: number): number[]

	sample(regions: RegionList, nsamples: number) {
		if (regions.length == 0) {
			return [];
		}
		const range = regions.reduce((acc,r) => acc + r.end - 10 - r.start, 0);
		const randoms = this.distribution(nsamples);
		const samples = [];
		for (let i = 0; i < nsamples; ++i) {
			const rs = regions.slice().sort((a,b) => a.start - b.start);
			let pos = Math.floor(randoms[i] * range);
			while (true) {
				pos += rs[0].start;
				if (pos > rs[0].end - 10) {
					pos -= rs[0].end - 10;
					rs.shift();
				} else {
					samples.push(new Region(pos, rs[0].end));
					break;
				}
			}
		}
		return samples;
	}

	reconcile(other: ActivationSamplePolicy) { return other.reconcileDistributionRandom(this); }
	reconcileAsap(_: ActivationSamplePolicy) { return this; }
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

class UniformRandomPolicy extends DistributionRandomPolicy {
	constructor() { super(); }

	distribution(n: number) {
		const nums = [];
		for (let i = 0; i < n; ++i) {
			nums.push(Math.random());
		}
		return nums;
	}
}

class LogNormalRandomPolicy extends DistributionRandomPolicy {
	constructor(readonly mu: number, readonly sigma: number) { super(); }

	distribution(n: number) {
		// see <https://en.wikipedia.org/wiki/Box%E2%80%93Muller_transform>
		let nums = [], min = Infinity, max = 0.0;
		const halfn = Math.ceil(n / 2);
		for (let i = 0; i < halfn; ++i) {
			let x, y, r2;
			do {
				x = Math.random() * 2.0 - 1.0;
				y = Math.random() * 2.0 - 1.0;
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
		return nums.map(n => (n - min) / range);
	}
}

class ErlangRandomPolicy extends DistributionRandomPolicy {
	constructor(readonly k: number, readonly lambda: number) { super(); }

	distribution(n: number) {
		const nums = [];
		let min = Infinity, max = 0.0;
		for (let i = 0; i < n; ++i) {
			let u = 1.0;
			for (let j = 0; j < this.k; ++j) {
				u *= Math.random();
			}
			const x = -Math.log(u) / this.lambda;
			min = Math.min(min, x);
			max = Math.max(max, x);
			nums.push(x);
		}
		const range = max - min;
		return nums.map(x => (x - min) / range);
	}
}

const StraightRandomPolicy = Object.freeze({
	sample(regions: RegionList, nsamples: number) {
		// regular RandomPolicy weights regions by their length, so any given point has an equal chance to be chosen across all regions
		// StraightRandomPolicy first picks a region with equal chance regardless of length, and then picks a random point on that region
		if (regions.length == 0) {
			return [];
		}
		const samples = [];
		for (let i = 0; i < nsamples; ++i) {
			const r = regions[Math.floor(Math.random() * regions.length)];
			samples.push(r.start + Math.floor(Math.random() * (r.end - r.start - 10)));
		}
		return samples.map(pos => new Region(pos, pos + 10));
	},
	reconcile(other: ActivationSamplePolicy) { return other.reconcileStraightRandom(this); },
	reconcileAsap(_: ActivationSamplePolicy) { return this; },
	reconcileDistributionRandom(_: ActivationSamplePolicy) { return this; },
	reconcileRandom(_: ActivationSamplePolicy) { return this; },
	reconcileStraightRandom(other: ActivationSamplePolicy) { return other; },
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { throw new Error('cannot reconcile StraightRandomPolicy with AllCornerRandomPolicy'); }
});

const AllCornerRandomPolicy = Object.freeze({
	placeTriggers(regions: RegionList) {
		const triggers = [];
		const candidates = regions.slice();
		candidates.sort((a,b) => a.start - b.start);
		while (triggers.length < 4 && candidates.length > 0) {
			const ci = Math.floor(Math.random() * candidates.length);
			const c = candidates[ci];
			const start = c.start + Math.floor(Math.random() * (c.end - c.start - 10));
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
	sample(regions: RegionList, nsamples: number) {
		const samples = [];
		for (let i = 0; i < nsamples; ++i) {
			samples.push(this.placeTriggers(regions));
		}
		return samples;
	},
	reconcile(other: ActivationSamplePolicy) { return other.reconcileAllCornerRandom(this); },
	reconcileAsap(_: ActivationSamplePolicy) { return this; },
	reconcileDistributionRandom(_: ActivationSamplePolicy) { return this; },
	reconcileRandom(_: ActivationSamplePolicy) { return this; },
	reconcileStraightRandom(_: ActivationSamplePolicy) { throw new Error('cannot reconcile StraightRandomPolicy with AllCornerRandomPolicy'); },
	reconcileAllCornerRandom(_: ActivationSamplePolicy) { return this; }
});

export interface Condition {
	samplePolicy: ActivationSamplePolicy
	filterEq(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterNeq(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterLt(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterLte(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterGt(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterGte(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
}

function notSupported(_0: RegionList, _1: number, _2: CourseData, _3: HorseParameters): never {
	assert(false, 'unsupported comparison');
	throw 0; // appease typescript
}

function noop(regions: RegionList, _1: number, _2: CourseData, _3: HorseParameters) {
	return regions;
}

const noopAll = Object.freeze({
	filterEq: noop,
	filterNeq: noop,
	filterLt: noop,
	filterLte: noop,
	filterGt: noop,
	filterGte: noop
});

const noopAsap = Object.freeze(Object.assign({samplePolicy: AsapPolicy}, noopAll));
const noopRandom = Object.freeze(Object.assign({samplePolicy: RandomPolicy}, noopAll));

const defaultAsap = Object.freeze({
	samplePolicy: AsapPolicy,
	filterEq: notSupported,
	filterNeq: notSupported,
	filterLt: notSupported,
	filterLte: notSupported,
	filterGt: notSupported,
	filterGte: notSupported
});

function asap(o: Partial<Condition>) {
	return Object.assign({}, defaultAsap, o);
}

const defaultRandom = Object.freeze({
	samplePolicy: RandomPolicy,
	filterEq: notSupported,
	filterNeq: notSupported,
	filterLt: notSupported,
	filterLte: notSupported,
	filterGt: notSupported,
	filterGte: notSupported
});

function random(o: Partial<Condition>) {
	return Object.assign({}, defaultRandom, o);
}

// ive tried various things to make this return a [xRandom,noopXRandom] pair but seem to run into some typescript bugs
// or something
// it doesnt really make sense to me
function distributionRandomFactory<Ts extends unknown[]>(cls: new (...args: Ts) => DistributionRandomPolicy) {
	const cache = Object.create(null);
	return function (...args: [...clsArgs: Ts, o: Partial<Condition>]) {
		const o = args.pop();
		const key = args.join(',');
		// we know that after pop() args is just Ts but typescript doesn't, hence the cast
		const policy = key in cache ? cache[key] : (cache[key] = Object.freeze(new cls(...args as unknown as Ts)));
		return Object.assign({
			samplePolicy: policy,
			filterEq: notSupported,
			filterNeq: notSupported,
			filterLt: notSupported,
			filterLte: notSupported,
			filterGt: notSupported,
			filterGte: notSupported
		}, o);
	};
}

const logNormalRandom = distributionRandomFactory(LogNormalRandomPolicy);
const erlangRandom = distributionRandomFactory(ErlangRandomPolicy);
const uniformRandom = distributionRandomFactory(UniformRandomPolicy);

function noopLogNormalRandom(mu: number, sigma: number) {
	return logNormalRandom(mu, sigma, noopAll);
}

function noopErlangRandom(k: number, lambda: number) {
	return erlangRandom(k, lambda, noopAll);
}

const noopUniformRandom = uniformRandom(noopAll);

/*
	accumulatetime, activate_count_all, activate_count_end_after, activate_count_heal, activate_count_middle, activate_count_start,
	all_corner_random, always, bashin_diff_behind, bashin_diff_infront, behind_near_lane_time, behind_near_lane_time_set1, blocked_all_continuetime,
	blocked_front, blocked_front_continuetime, blocked_side_continuetime, change_order_onetime, change_order_up_end_after,
	change_order_up_finalcorner_after, compete_fight_count, corner, corner_random, distance_diff_rate, distance_diff_top, distance_rate,
	distance_rate_after_random, distance_type, down_slope_random, grade, ground_condition, ground_type, hp_per, infront_near_lane_time, is_badstart,
	is_basis_distance, is_behind_in, is_exist_chara_id, is_finalcorner, is_finalcorner_laterhalf, is_finalcorner_random, is_hp_empty_onetime,
	is_last_straight_onetime, is_lastspurt, is_move_lane, is_overtake, is_surrounded, is_temptation, lane_type, last_straight_random, near_count,
	order, order_rate, order_rate_in20_continue, order_rate_in40_continue, order_rate_out40_continue, order_rate_out50_continue,
	order_rate_out70_continue, overtake_target_no_order_up_time, overtake_target_time, phase, phase_firsthalf_random, phase_laterhalf_random,
	phase_random, popularity, post_number, random_lot, remain_distance, remain_distance_viewer_id, rotation, running_style,
	running_style_count_nige_otherself, running_style_count_oikomi_otherself, running_style_count_same, running_style_count_same_rate,
	running_style_count_sashi_otherself, running_style_count_senko_otherself, running_style_equal_popularity_one,
	running_style_temptation_count_nige, running_style_temptation_count_oikomi, running_style_temptation_count_sashi,
	running_style_temptation_count_senko, same_skill_horse_count, season, slope, straight_front_type, straight_random, temptation_count,
	temptation_count_behind, temptation_count_infront, track_id, up_slope_random, weather
*/

export const Conditions: {[cond: string]: Condition} = Object.freeze({
	accumulatetime: asap({
		filterGte(regions: RegionList, t: number, _0: CourseData, _1: HorseParameters) {
			return [regions, (s: RaceState) => s.accumulatetime >= t] as [RegionList, DynamicCondition];
		}
	}),
	all_corner_random: {
		samplePolicy: AllCornerRandomPolicy,
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be all_corner_random==1');
			const corners = course.corners.map(c => new Region(c.start, c.start + c.length));
			return regions.rmap(r => corners.map(c => r.intersect(c)));
		},
		filterNeq: notSupported,
		filterLt: notSupported,
		filterLte: notSupported,
		filterGt: notSupported,
		filterGte: notSupported
	},
	behind_near_lane_time: noopErlangRandom(3, 2.0),
	blocked_side_continuetime: noopErlangRandom(3, 2.0),
	change_order_onetime: noopErlangRandom(3, 2.0),
	compete_fight_count: uniformRandom({
		filterGt(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters) {
			assert(CourseHelpers.isSortedByStart(course.straights), 'course straights must be sorted by start');
			const lastStraight = course.straights[course.straights.length - 1];
			return regions.rmap(r => r.intersect(lastStraight));
		}
	}),
	corner: asap({
		filterEq(regions: RegionList, cornerNum: number, course: CourseData, _: HorseParameters) {
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (cornerNum == 0) {
				// can't simply use straights here as there may be parts of a course which are neither corners nor straights
				let lastEnd = 0;
				const nonCorners = course.corners.map(c => {
					const r = new Region(lastEnd, c.start);
					lastEnd = c.start + c.length;
					return r;
				});
				if (lastEnd != course.distance) {
					nonCorners.push(new Region(lastEnd, course.distance));
				}
				return regions.rmap(r => nonCorners.map(s => r.intersect(s)));
			} else {
				const corner = course.corners[course.corners.length + cornerNum - 5];
				const cornerBounds = new Region(corner.start, corner.start + corner.length);
				return regions.rmap(r => r.intersect(cornerBounds));
			}
		},
		filterNeq(regions: RegionList, cornerNum: number, course: CourseData, _: HorseParameters) {
			assert(cornerNum == 0, 'only supports corner!=0');
			const corners = course.corners.map(c => new Region(c.start, c.start + c.length));
			return regions.rmap(r => corners.map(c => r.intersect(c)));
		}
	}),
	distance_diff_top: noopAsap,
	distance_rate: asap({
		filterGte(regions: RegionList, rate: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(course.distance * rate / 100, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	distance_rate_after_random: random({
		filterEq(regions: RegionList, rate: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(course.distance * rate / 100, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	distance_type: asap({
		filterEq(regions: RegionList, distanceType: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsDistanceType(distanceType);
			if (course.distanceType == distanceType) {
				return regions;
			} else {
				return new RegionList();
			}
		}
	}),
	down_slope_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be down_slope_random==1');
			const slopes = course.slopes.filter(s => s.slope < 0).map(s => new Region(s.start, s.start + s.length));
			return regions.rmap(r => slopes.map(s => r.intersect(s)));
		}
	}),
	// TODO in order to properly simulate skills that depend on hp_per this condition should pass a dynamic condition on to the
	// race solver. This is a bit more long-term since that would require simulating stamina, and therefore recoveries, and honestly
	// would be kind of a pain in general, and probably impossible to do accurately due to things like 位置取り争い that depend on other
	// umas, as well as random factors like downhill accel mode.
	// The only skill likely severely affected by this is Akebono's unique.
	hp_per: noopAsap,
	infront_near_lane_time: noopErlangRandom(3, 2.0),
	is_finalcorner: asap({
		filterEq(regions: RegionList, flag: number, course: CourseData, _: HorseParameters) {
			assert(flag == 0 || flag == 1, 'must be is_finalcorner==0 or is_finalcorner==1');
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (course.corners.length == 0) {
				return new RegionList();
			}
			const finalCornerStart = course.corners[course.corners.length - 1].start;
			const bounds = flag ? new Region(finalCornerStart, course.distance) : new Region(0, finalCornerStart);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	is_finalcorner_laterhalf: asap({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_finalcorner_laterhalf==1');
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (course.corners.length == 0) {
				return new RegionList();
			}
			const fc = course.corners[course.corners.length - 1];
			const bounds = new Region((fc.start + fc.start + fc.length) / 2, fc.start + fc.length);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	is_finalcorner_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_finalcorner_random==1');
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (course.corners.length == 0) {
				return new RegionList();
			}
			const fc = course.corners[course.corners.length - 1];
			const bounds = new Region(fc.start, fc.start + fc.length);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	is_lastspurt: asap({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_lastspurt==1');
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 2), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	is_last_straight_onetime: asap({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_last_straight_onetime==1');
			assert(CourseHelpers.isSortedByStart(course.straights), 'course straights must be sorted by start');
			const lastStraightStart = course.straights[course.straights.length - 1].start;
			// TODO ask kuromi about this or something
			const trigger = new Region(lastStraightStart, lastStraightStart + 10);
			return regions.rmap(r => r.intersect(trigger));
		}
	}),
	is_surrounded: noopErlangRandom(3, 2.0),
	near_count: noopErlangRandom(3, 2.0),
	order: noopAsap,
	order_rate: noopAsap,
	order_rate_in20_continue: noopAsap,
	order_rate_in40_continue: noopAsap,
	order_rate_out40_continue: noopAsap,
	order_rate_out50_continue: noopAsap,
	order_rate_out70_continue: noopAsap,
	phase: {
		samplePolicy: AsapPolicy,
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), CourseHelpers.phaseEnd(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		},
		filterNeq: notSupported,
		filterLt(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			assert(phase > 0, 'phase == 0');
			const bounds = new Region(0, CourseHelpers.phaseStart(course.distance, (phase - 1) as Phase));
			return regions.rmap(r => r.intersect(bounds));
		},
		filterLte(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(0, CourseHelpers.phaseStart(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGt(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			assert(phase < 3, 'phase > 2');
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, (phase + 1) as Phase), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGte(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	},
	phase_laterhalf_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const start = CourseHelpers.phaseStart(course.distance, phase);
			const end = CourseHelpers.phaseEnd(course.distance, phase);
			const bounds = new Region((start + end) / 2, end);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	phase_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), CourseHelpers.phaseEnd(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	remain_distance: asap({
		filterLte(regions: RegionList, remain: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(course.distance - remain, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGte(regions: RegionList, remain: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(0, course.distance - remain);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	rotation: asap({
		filterEq(regions: RegionList, rotation: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsOrientation(rotation);
			return course.turn == rotation ? regions : new RegionList();
		}
	}),
	running_style: asap({
		filterEq(regions: RegionList, strategy: number, _: CourseData, horse: HorseParameters) {
			StrategyHelpers.assertIsStrategy(strategy);
			if (StrategyHelpers.strategyMatches(horse.strategy, strategy)) {
				return regions;
			} else {
				return new RegionList();
			}
		}
	}),
	slope: asap({
		filterEq(regions: RegionList, slopeType: number, course: CourseData, _: HorseParameters) {
			assert(slopeType == 0 || slopeType == 1 || slopeType == 2, 'slopeType');
			// Requires course.slopes is sorted by slope start— this is not always the case, since in course_data.json they are
			// (sometimes?) sorted first by uphill/downhill and then by start. They should be sorted when the course is loaded.
			assert(CourseHelpers.isSortedByStart(course.slopes), 'course slopes must be sorted by slope start');
			let lastEnd = 0;
			const slopes = course.slopes.filter(s => (slopeType != 2 && s.slope > 0) || (slopeType != 1 && s.slope < 0));
			const slopeR = slopeType == 0 ? slopes.map(s => {
				const r = new Region(lastEnd, s.start);
				lastEnd = s.start + s.length;
				return r;
			}) : slopes.map(s => new Region(s.start, s.start + s.length));
			if (slopeType == 0 && lastEnd != course.distance) {
				slopeR.push(new Region(lastEnd, course.distance));
			}
			return regions.rmap(r => slopeR.map(s => r.intersect(s)));
		}
	}),
	straight_random: {
		samplePolicy: StraightRandomPolicy,
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be straight_random==1');
			return regions.rmap(r => course.straights.map(s => r.intersect(s)));
		},
		filterNeq: notSupported,
		filterLt: notSupported,
		filterLte: notSupported,
		filterGt: notSupported,
		filterGte: notSupported
	},
	temptation_count: noopAsap,
	up_slope_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be up_slope_random==1');
			const slopes = course.slopes.filter(s => s.slope > 0).map(s => new Region(s.start, s.start + s.length));
			return regions.rmap(r => slopes.map(s => r.intersect(s)));
		}
	})
});
