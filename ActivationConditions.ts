const assert = require('assert').strict;

import { CourseData, CourseHelpers, Phase } from './CourseData';
import { HorseParameters, StrategyHelpers } from './HorseTypes';
import { Region, RegionList } from './Region';
import { RaceState, DynamicCondition } from './RaceSolver';
import { RaceParameters } from './RaceParameters';
import {
	ActivationSamplePolicy,
	ImmediatePolicy, RandomPolicy,
	DistributionRandomPolicy, UniformRandomPolicy, LogNormalRandomPolicy, ErlangRandomPolicy,
	StraightRandomPolicy, AllCornerRandomPolicy
} from './ActivationSamplePolicy';

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
	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters): [RegionList, DynamicCondition]
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

	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
		return withDefaultCond(this.condition.filterEq(regions, this.argument, course, horse, extra));
	}
}

export class NeqOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
		return withDefaultCond(this.condition.filterNeq(regions, this.argument, course, horse, extra));
	}
}

export class LtOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
		return withDefaultCond(this.condition.filterLt(regions, this.argument, course, horse, extra));
	}
}

export class LteOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
		return withDefaultCond(this.condition.filterLte(regions, this.argument, course, horse, extra));
	}
}

export class GtOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
		return withDefaultCond(this.condition.filterGt(regions, this.argument, course, horse, extra));
	}
}

export class GteOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
		return withDefaultCond(this.condition.filterGte(regions, this.argument, course, horse, extra));
	}
}

export class AndOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly left: Operator, readonly right: Operator) {
		this.samplePolicy = left.samplePolicy.reconcile(right.samplePolicy);
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
		const [leftval, leftcond] = this.left.apply(regions, course, horse, extra);
		const [rightval, rightcond] = this.right.apply(leftval, course, horse, extra);
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

	apply(regions: RegionList, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
		const [leftval, leftcond] = this.left.apply(regions, course, horse, extra);
		const [rightval, rightcond] = this.right.apply(regions, course, horse, extra);
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

export interface Condition {
	samplePolicy: ActivationSamplePolicy
	filterEq(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters, extra: RaceParameters): RegionList | [RegionList, DynamicCondition]
	filterNeq(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters, extra: RaceParameters): RegionList | [RegionList, DynamicCondition]
	filterLt(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters, extra: RaceParameters): RegionList | [RegionList, DynamicCondition]
	filterLte(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters, extra: RaceParameters): RegionList | [RegionList, DynamicCondition]
	filterGt(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters, extra: RaceParameters): RegionList | [RegionList, DynamicCondition]
	filterGte(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters, extra: RaceParameters): RegionList | [RegionList, DynamicCondition]
}

function notSupported(_0: RegionList, _1: number, _2: CourseData, _3: HorseParameters, extra: RaceParameters): never {
	assert(false, 'unsupported comparison');
	throw 0; // appease typescript
}

function noop(regions: RegionList, _1: number, _2: CourseData, _3: HorseParameters, extra: RaceParameters) {
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

export const noopImmediate = Object.freeze(Object.assign({samplePolicy: ImmediatePolicy}, noopAll));
export const noopRandom = Object.freeze(Object.assign({samplePolicy: RandomPolicy}, noopAll));

const defaultImmediate = Object.freeze({
	samplePolicy: ImmediatePolicy,
	filterEq: notSupported,
	filterNeq: notSupported,
	filterLt: notSupported,
	filterLte: notSupported,
	filterGt: notSupported,
	filterGte: notSupported
});

export function immediate(o: Partial<Condition>) {
	return Object.assign({}, defaultImmediate, o);
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

export function random(o: Partial<Condition>) {
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

export const logNormalRandom = distributionRandomFactory(LogNormalRandomPolicy);
export const erlangRandom = distributionRandomFactory(ErlangRandomPolicy);
export const uniformRandom = distributionRandomFactory(UniformRandomPolicy);

export function noopLogNormalRandom(mu: number, sigma: number) {
	return logNormalRandom(mu, sigma, noopAll);
}

export function noopErlangRandom(k: number, lambda: number) {
	return erlangRandom(k, lambda, noopAll);
}

export const noopUniformRandom = uniformRandom(noopAll);

function valueFilter(getValue: (c: CourseData, h: HorseParameters, e: RaceParameters) => number) {
	return immediate({
		filterEq(regions: RegionList, value: number, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
			return getValue(course, horse, extra) == value ? regions : new RegionList();
		},
		filterNeq(regions: RegionList, value: number, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
			return getValue(course, horse, extra) != value ? regions : new RegionList();
		},
		filterLt(regions: RegionList, value: number, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
			return getValue(course, horse, extra) < value ? regions : new RegionList();
		},
		filterLte(regions: RegionList, value: number, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
			return getValue(course, horse, extra) <= value ? regions : new RegionList();
		},
		filterGt(regions: RegionList, value: number, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
			return getValue(course, horse, extra) > value ? regions : new RegionList();
		},
		filterGte(regions: RegionList, value: number, course: CourseData, horse: HorseParameters, extra: RaceParameters) {
			return getValue(course, horse, extra) >= value ? regions : new RegionList();
		}
	});
}

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
	accumulatetime: immediate({
		filterGte(regions: RegionList, t: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return [regions, (s: RaceState) => s.accumulatetime.t >= t] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_all: immediate({
		filterLte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return [regions, (s: RaceState) => s.activateCount.reduce((a,b) => a + b) <= n] as [RegionList, DynamicCondition];
		},
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return [regions, (s: RaceState) => s.activateCount.reduce((a,b) => a + b) >= n] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_end_after: immediate({
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return [regions, (s: RaceState) => s.activateCount[2] >= n] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_heal: immediate({
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return [regions, (s: RaceState) => s.activateCountHeal >= n] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_middle: immediate({
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return [regions, (s: RaceState) => s.activateCount[1] >= n] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_start: immediate({
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return [regions, (s: RaceState) => s.activateCount[0] >= n] as [RegionList, DynamicCondition];
		}
	}),
	all_corner_random: {
		samplePolicy: AllCornerRandomPolicy,
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
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
	always: noopImmediate,
	// NB. since skill conditions are processed before any skill activations, stats here are base stats (i.e. greens are not included)
	base_power: valueFilter((_: CourseData, horse: HorseParameters, extra: RaceParameters) => horse.power),
	base_speed: valueFilter((_: CourseData, horse: HorseParameters, extra: RaceParameters) => horse.speed),
	base_stamina: valueFilter((_: CourseData, horse: HorseParameters, extra: RaceParameters) => horse.stamina),
	base_guts: valueFilter((_: CourseData, horse: HorseParameters, extra: RaceParameters) => horse.guts),
	base_wiz: valueFilter((_: CourseData, horse: HorseParameters, extra: RaceParameters) => horse.wisdom),
	bashin_diff_behind: noopErlangRandom(3, 2.0),
	bashin_diff_infront: noopErlangRandom(3, 2.0),
	behind_near_lane_time: noopErlangRandom(3, 2.0),
	// NB. at least in theory _set1 should have a slightly more early-biased distribution since it's technically easier to activate, but I don't
	// really think it makes much of a difference. Same with blocked_front vs blocked_front_continuetime I suppose.
	behind_near_lane_time_set1: noopErlangRandom(3, 2.0),
	blocked_all_continuetime: noopErlangRandom(3, 2.0),
	blocked_front: noopErlangRandom(3, 2.0),
	blocked_front_continuetime: noopErlangRandom(3, 2.0),
	blocked_side_continuetime: noopErlangRandom(3, 2.0),
	change_order_onetime: noopErlangRandom(3, 2.0),
	change_order_up_end_after: erlangRandom(3, 2.0, {
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 2), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	change_order_up_finalcorner_after: erlangRandom(3, 2.0, {
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (course.corners.length == 0) {
				return new RegionList();
			}
			const finalCornerStart = course.corners[course.corners.length - 1].start;
			const bounds = new Region(finalCornerStart, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	change_order_up_middle: erlangRandom(3, 2.0, {
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 1), CourseHelpers.phaseEnd(course.distance, 1));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	compete_fight_count: uniformRandom({
		filterGt(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			assert(CourseHelpers.isSortedByStart(course.straights), 'course straights must be sorted by start');
			const lastStraight = course.straights[course.straights.length - 1];
			return regions.rmap(r => r.intersect(lastStraight));
		}
	}),
	corner: immediate({
		filterEq(regions: RegionList, cornerNum: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
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
			} else if (course.corners.length + cornerNum >= 5) {
				const corners = [];
				for (let cornerIdx = course.corners.length + cornerNum - 5; cornerIdx >= 0; cornerIdx -= 4) {
					const corner = course.corners[cornerIdx];
					corners.push(new Region(corner.start, corner.start + corner.length));
				}
				corners.reverse();
				return regions.rmap(r => corners.map(c => r.intersect(c)));
			} else {
				return new RegionList();
			}
		},
		filterNeq(regions: RegionList, cornerNum: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(cornerNum == 0, 'only supports corner!=0');
			const corners = course.corners.map(c => new Region(c.start, c.start + c.length));
			return regions.rmap(r => corners.map(c => r.intersect(c)));
		}
	}),
	corner_count: valueFilter((course: CourseData, _: HorseParameters, extra: RaceParameters) => course.corners.length),
	// FIXME this shouldn't actually be random, since in cases like corner_random==1@corner_random==2 it should sample
	// only from the first corner and not from the combined regions, so it needs its own sample policy
	// actually, that's slightly annoying to handle since corners come in back-to-back pairs, so their regions will
	// get merged by the union operation.
	// the real way to fix this is to finally allow placing multiple triggers, then each branch of an @ can simply
	// place its own trigger and the problem goes away.
	corner_random: random({
		filterEq(regions: RegionList, cornerNum: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (course.corners.length + cornerNum >= 5) {
				const corner = course.corners[course.corners.length + cornerNum - 5];
				const cornerBounds = new Region(corner.start, corner.start + corner.length);
				return regions.rmap(r => r.intersect(cornerBounds));
			} else {
				return new RegionList();
			}
		}
	}),
	course_distance: valueFilter((course: CourseData, _: HorseParameters, extra: RaceParameters) => course.distance),
	distance_diff_rate: noopImmediate,
	distance_diff_top: noopImmediate,
	distance_diff_top_float: noopImmediate,
	distance_rate: immediate({
		filterLte(regions: RegionList, rate: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(0, course.distance * rate / 100);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGte(regions: RegionList, rate: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(course.distance * rate / 100, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	distance_rate_after_random: random({
		filterEq(regions: RegionList, rate: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(course.distance * rate / 100, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	distance_type: immediate({
		filterEq(regions: RegionList, distanceType: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsDistanceType(distanceType);
			if (course.distanceType == distanceType) {
				return regions;
			} else {
				return new RegionList();
			}
		},
		filterNeq(regions: RegionList, distanceType: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsDistanceType(distanceType);
			if (course.distanceType != distanceType) {
				return regions;
			} else {
				return new RegionList();
			}
		}
	}),
	down_slope_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(one == 1, 'must be down_slope_random==1');
			const slopes = course.slopes.filter(s => s.slope < 0).map(s => new Region(s.start, s.start + s.length));
			return regions.rmap(r => slopes.map(s => r.intersect(s)));
		}
	}),
	grade: valueFilter((_0: CourseData, _1: HorseParameters, extra: RaceParameters) => extra.grade),
	ground_condition: valueFilter((_0: CourseData, _1: HorseParameters, extra: RaceParameters) => extra.groundCondition),
	ground_type: valueFilter((course: CourseData, _: HorseParameters, extra: RaceParameters) => course.surface),
	hp_per: immediate({
		filterLte(regions: RegionList, hpPer: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			hpPer /= 100;
			return [regions, (s: RaceState) => s.hp.hpRatioRemaining() <= hpPer] as [RegionList, DynamicCondition];
		},
		filterGte(regions: RegionList, hpPer: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			hpPer /= 100;
			return [regions, (s: RaceState) => s.hp.hpRatioRemaining() >= hpPer] as [RegionList, DynamicCondition];
		}
	}),
	infront_near_lane_time: noopErlangRandom(3, 2.0),
	is_activate_other_skill_detail: immediate({
		filterEq(regions: RegionList, one: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			assert(one == 1, 'must be is_activate_other_skill_detail==1');
			return [regions, (s: RaceState) => s.usedSkills.has(extra.skillId)] as [RegionList, DynamicCondition];
		}
	}),
	is_basis_distance: immediate({
		filterEq(regions: RegionList, flag: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(flag == 0 || flag == 1, 'must be is_basis_distance==0 or is_basis_distance==1');
			return Math.min(course.distance % 400, 1) != flag ? regions : new RegionList();
		}
	}),
	is_badstart: noopImmediate,
	is_behind_in: noopImmediate,
	is_dirtgrade: immediate({
		filterEq(regions: RegionList, flag: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(flag == 1, 'must be is_dirtgrade==1');
			return [10101, 10103, 10104, 10105].indexOf(course.raceTrackId) > -1 ? regions : new RegionList();
		}
	}),
	is_finalcorner: immediate({
		filterEq(regions: RegionList, flag: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
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
	is_finalcorner_laterhalf: immediate({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
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
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
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
	is_lastspurt: immediate({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(one == 1, 'must be is_lastspurt==1');
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 2), course.distance);
			return [regions.rmap(r => r.intersect(bounds)), (s: RaceState) => s.isLastSpurt] as [RegionList, DynamicCondition];
		}
	}),
	is_last_straight: immediate({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(one == 1, 'must be is_last_straight_onetime==1');
			assert(CourseHelpers.isSortedByStart(course.straights), 'course straights must be sorted by start');
			const lastStraight = course.straights[course.straights.length - 1];
			return regions.rmap(r => r.intersect(lastStraight));
		}
	}),
	is_last_straight_onetime: immediate({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(one == 1, 'must be is_last_straight_onetime==1');
			assert(CourseHelpers.isSortedByStart(course.straights), 'course straights must be sorted by start');
			const lastStraightStart = course.straights[course.straights.length - 1].start;
			// TODO ask kuromi about this or something
			const trigger = new Region(lastStraightStart, lastStraightStart + 10);
			return regions.rmap(r => r.intersect(trigger));
		}
	}),
	is_move_lane: noopErlangRandom(5, 1.0),
	is_overtake: noopErlangRandom(1, 2.0),
	is_surrounded: noopErlangRandom(3, 2.0),
	is_used_skill_id: immediate({
		filterEq(regions: RegionList, skillId: number, _0: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return [regions, (s: RaceState) => s.usedSkills.has('' + skillId)] as [RegionList, DynamicCondition];
		}
	}),
	lane_type: noopImmediate,
	lastspurt: immediate({
		filterEq(regions: RegionList, case_: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			// NB. not entirely sure these are correct, based on some vague remarks made by kuromi once
			let f;
			switch (case_) {
			case 1:
				f = (s: RaceState) => s.isLastSpurt && s.lastSpurtTransition != -1;
				break;
			case 2:
				f = (s: RaceState) => s.isLastSpurt && s.lastSpurtTransition == -1;
				break;
			case 3:
				f = (s: RaceState) => !s.isLastSpurt;
				break;
			default:
				assert(1 <= case_ && case_ <= 3, 'lastspurt case must be 1-3');
			}
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 2), course.distance);
			return [regions.rmap(r => r.intersect(bounds)), f] as [RegionList, DynamicCondition];
		}
	}),
	motivation: valueFilter((_0: CourseData, _1: HorseParameters, extra: RaceParameters) => extra.mood + 3),  // go from -2 to 2 to 1-5 scale
	near_count: noopErlangRandom(3, 2.0),
	order: noopImmediate,
	order_rate: noopImmediate,
	order_rate_in20_continue: noopImmediate,
	order_rate_in40_continue: noopImmediate,
	order_rate_in80_continue: noopImmediate,
	order_rate_out20_continue: noopImmediate,
	order_rate_out40_continue: noopImmediate,
	order_rate_out50_continue: noopImmediate,
	order_rate_out70_continue: noopImmediate,
	overtake_target_no_order_up_time: noopErlangRandom(3, 2.0),
	overtake_target_time: noopErlangRandom(3, 2.0),
	phase: {
		samplePolicy: ImmediatePolicy,
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			// add a little bit to the end to account for the fact that phase check happens later than skill activations
			// this is mainly relevant for skills with phase condition + a corner condition (e.g. kanata) because corner check
			// occurs before skill activations so when the start of a corner exactly coincides with the end of a phase (e.g.,
			// chuukyou 1800 dirt) these skills can activate on the first frame of what would be the next phase
			// obviously hard coding the skills we want to fudge this for is not really ideal, but it's not clear that it's
			// safe to do in all cases. technically to fix this `phase` should probably be a dynamic condition that actually
			// checks the phase to match in-game mechanics
			const fudge = ['100591', '900591', '110261', '910261', '110191', '910191', '120451', '920451', '101502121'].indexOf(extra.skillId) > -1 ? 10 : 0;
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), CourseHelpers.phaseEnd(course.distance, phase) + fudge);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterNeq: notSupported,
		filterLt(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			assert(phase > 0, 'phase == 0');
			const bounds = new Region(0, CourseHelpers.phaseStart(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		},
		filterLte(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(0, CourseHelpers.phaseEnd(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGt(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			assert(phase < 3, 'phase > 2');
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, (phase + 1) as Phase), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGte(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	},
	phase_corner_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const phaseStart = CourseHelpers.phaseStart(course.distance, phase);
			const phaseEnd = CourseHelpers.phaseEnd(course.distance, phase);
			const corners = course.corners
				.filter(c => (c.start >= phaseStart && c.start < phaseEnd) || (c.start + c.length >= phaseStart && c.start + c.length < phaseEnd))
				.map(c => new Region(Math.max(c.start, phaseStart), Math.min(c.start + c.length, phaseEnd)));
			return regions.rmap(r => corners.map(c => r.intersect(c)));
		}
	}),
	phase_firsthalf_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const start = CourseHelpers.phaseStart(course.distance, phase);
			const end = CourseHelpers.phaseEnd(course.distance, phase);
			const bounds = new Region(start, start + (end - start) / 2);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	phase_firstquarter: immediate({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const start = CourseHelpers.phaseStart(course.distance, phase);
			const end = CourseHelpers.phaseEnd(course.distance, phase);
			const bounds = new Region(start, start + (end - start) / 4);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	phase_firstquarter_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const start = CourseHelpers.phaseStart(course.distance, phase);
			const end = CourseHelpers.phaseEnd(course.distance, phase);
			const bounds = new Region(start, start + (end - start) / 4);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	phase_laterhalf_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const start = CourseHelpers.phaseStart(course.distance, phase);
			const end = CourseHelpers.phaseEnd(course.distance, phase);
			const bounds = new Region((start + end) / 2, end);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	phase_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), CourseHelpers.phaseEnd(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	phase_straight_random: {
		samplePolicy: StraightRandomPolicy,
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			CourseHelpers.assertIsPhase(phase);
			const phaseBounds = new Region(CourseHelpers.phaseStart(course.distance, phase), CourseHelpers.phaseEnd(course.distance, phase));
			return regions.rmap(r => course.straights.map(s => r.intersect(s))).rmap(r => r.intersect(phaseBounds));
		},
		filterNeq: notSupported,
		filterLt: notSupported,
		filterLte: notSupported,
		filterGt: notSupported,
		filterGte: notSupported
	},
	popularity: noopImmediate,
	post_number: noopImmediate,
	remain_distance: immediate({
		filterLte(regions: RegionList, remain: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(course.distance - remain, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGte(regions: RegionList, remain: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(0, course.distance - remain);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	rotation: valueFilter((course: CourseData, _: HorseParameters, extra: RaceParameters) => course.turn),
	running_style: immediate({
		filterEq(regions: RegionList, strategy: number, _: CourseData, horse: HorseParameters, extra: RaceParameters) {
			StrategyHelpers.assertIsStrategy(strategy);
			if (StrategyHelpers.strategyMatches(horse.strategy, strategy)) {
				return regions;
			} else {
				return new RegionList();
			}
		}
	}),
	running_style_count_same: noopImmediate,
	running_style_count_same_rate: noopImmediate,
	running_style_equal_popularity_one: noopImmediate,
	same_skill_horse_count: noopImmediate,
	season: valueFilter((_0: CourseData, _1: HorseParameters, extra: RaceParameters) => extra.season),
	slope: immediate({
		filterEq(regions: RegionList, slopeType: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
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
	straight_front_type: immediate({
		filterEq(regions: RegionList, frontType: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(frontType == 1 || frontType == 2, 'frontType');
			const straights = course.straights.filter(s => s.frontType == frontType);
			return regions.rmap(r => straights.map(s => r.intersect(s)));
		}
	}),
	straight_random: {
		samplePolicy: StraightRandomPolicy,
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(one == 1, 'must be straight_random==1');
			return regions.rmap(r => course.straights.map(s => r.intersect(s)));
		},
		filterNeq: notSupported,
		filterLt: notSupported,
		filterLte: notSupported,
		filterGt: notSupported,
		filterGte: notSupported
	},
	temptation_count: noopImmediate,
	time: valueFilter((_0: CourseData, _1: HorseParameters, extra: RaceParameters) => extra.time),
	track_id: valueFilter((course: CourseData, _: HorseParameters, extra: RaceParameters) => course.raceTrackId),
	up_slope_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters, extra: RaceParameters) {
			assert(one == 1, 'must be up_slope_random==1');
			const slopes = course.slopes.filter(s => s.slope > 0).map(s => new Region(s.start, s.start + s.length));
			return regions.rmap(r => slopes.map(s => r.intersect(s)));
		}
	}),
	visiblehorse: noopImmediate,
	weather: valueFilter((_0: CourseData, _1: HorseParameters, extra: RaceParameters) => extra.weather)
});
