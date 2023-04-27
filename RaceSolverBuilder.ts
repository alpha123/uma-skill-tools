import { HorseParameters, Strategy, Aptitude } from './HorseTypes';
import { CourseData, CourseHelpers, DistanceType } from './CourseData';
import { Region, RegionList } from './Region';
import { Rule30CARng } from './Random';
import { Conditions, random, immediate } from './ActivationConditions';
import { ActivationSamplePolicy, ImmediatePolicy } from './ActivationSamplePolicy';
import { parse, tokenize } from './ConditionParser';
import { RaceSolver, PendingSkill, DynamicCondition, SkillType, SkillRarity, SkillEffect } from './RaceSolver';

import skills from './data/skill_data.json';

export interface HorseDesc {
	speed: number
	stamina: number
	power: number
	guts: number
	wisdom: number
	strategy: string | Strategy
	distanceAptitude: string | Aptitude
	surfaceAptitude: string | Aptitude
	strategyAptitude: string | Aptitude
}

export const enum GroundCondition { Good = 1, Yielding, Soft, Heavy }

export type Mood = -2 | -1 | 0 | 1 | 2;

const GroundSpeedModifier = Object.freeze([
	null, // ground types started at 1
	[0, 0, 0, 0, -50],
	[0, 0, 0, 0, -50]
].map(o => Object.freeze(o)));

const GroundPowerModifier = Object.freeze([
	null,
	[0, 0, -50, -50, -50],
	[0, -100, -50, -100, -100]
].map(o => Object.freeze(o)));

const StrategyProficiencyModifier = Object.freeze([1.1, 1.0, 0.85, 0.75, 0.6, 0.4, 0.2, 0.1]);

namespace Asitame {
	export const StrategyDistanceCoefficient = Object.freeze([
		[],  // distances are 1-indexed (as are strategies, hence the 0 in the first column for every row)
		[0, 1.0, 0.7, 0.75,  0.7,  1.0],  // short (nige, senkou, sasi, oikomi, oonige)
		[0, 1.0, 0.8, 0.7,   0.75, 1.0],  // mile
		[0, 1.0, 0.9, 0.875, 0.86, 1.0],  // medium
		[0, 1.0, 0.9, 1.0,   0.9,  1.0]   // long
	]);

	export const BaseModifier = 0.00875;

	export function calcApproximateModifier(power: number, strategy: Strategy, distance: DistanceType) {
		return BaseModifier * Math.sqrt(power - 1200) * StrategyDistanceCoefficient[distance][strategy];
	}
}

export function parseStrategy(s: string | Strategy) {
	if (typeof s != 'string') {
		return s;
	}
	switch (s.toUpperCase()) {
	case 'NIGE': return Strategy.Nige;
	case 'SENKOU': return Strategy.Senkou;
	case 'SASI':
	case 'SASHI': return Strategy.Sasi;
	case 'OIKOMI': return Strategy.Oikomi;
	case 'OONIGE': return Strategy.Oonige;
	default: throw new Error('Invalid running strategy.');
	}
}

export function parseAptitude(a: string | Aptitude, type: string) {
	if (typeof a != 'string') {
		return a;
	}
	switch (a.toUpperCase()) {
	case 'S': return Aptitude.S;
	case 'A': return Aptitude.A;
	case 'B': return Aptitude.B;
	case 'C': return Aptitude.C;
	case 'D': return Aptitude.D;
	case 'E': return Aptitude.E;
	case 'F': return Aptitude.F;
	case 'G': return Aptitude.G;
	default: throw new Error('Invalid ' + type + ' aptitude.');
	}
}

function adjustOvercap(stat: number) {
	return stat > 1200 ? 1200 + Math.floor((stat - 1200) / 2) : stat;
}

export function buildBaseStats(horseDesc: HorseDesc, mood: Mood) {
	const motivCoef = 1 + 0.02 * mood;

	return Object.freeze({
		speed: adjustOvercap(horseDesc.speed) * motivCoef,
		stamina: adjustOvercap(horseDesc.stamina) * motivCoef,
		power: adjustOvercap(horseDesc.power) * motivCoef,
		guts: adjustOvercap(horseDesc.guts) * motivCoef,
		wisdom: adjustOvercap(horseDesc.wisdom) * motivCoef,
		strategy: parseStrategy(horseDesc.strategy),
		distanceAptitude: parseAptitude(horseDesc.distanceAptitude, 'distance'),
		surfaceAptitude: parseAptitude(horseDesc.surfaceAptitude, 'surface'),
		strategyAptitude: parseAptitude(horseDesc.strategyAptitude, 'strategy')
	});
}

export function buildAdjustedStats(baseStats: HorseParameters, course: CourseData, ground: GroundCondition) {
	const raceCourseModifier = CourseHelpers.courseSpeedModifier(course, baseStats);

	return Object.freeze({
		speed: Math.max(baseStats.speed * raceCourseModifier + GroundSpeedModifier[course.surface][ground], 1),
		stamina: baseStats.stamina,
		power: Math.max(baseStats.power + GroundPowerModifier[course.surface][ground], 1),
		guts: baseStats.guts,
		wisdom: baseStats.wisdom * StrategyProficiencyModifier[baseStats.strategyAptitude],
		strategy: baseStats.strategy,
		distanceAptitude: baseStats.distanceAptitude,
		surfaceAptitude: baseStats.surfaceAptitude,
		strategyAptitude: baseStats.strategyAptitude
	});
}

export interface SkillData {
	skillId: string
	rarity: SkillRarity
	samplePolicy: ActivationSamplePolicy,
	regions: RegionList,
	extraCondition: DynamicCondition,
	effects: SkillEffect[]
}

function buildSkillEffects(skill) {
	// im on a really old version of node and cant use flatMap
	return skill.effects.reduce((acc,ef) => {
		if (ef.type == 21) {  // debuffs
			acc.push({type: SkillType.CurrentSpeed, baseDuration: skill.baseDuration / 10000, modifier: ef.modifier / 10000});
			acc.push({type: SkillType.TargetSpeed, baseDuration: skill.baseDuration / 10000, modifier: ef.modifier / 10000});
		} else if (SkillType.hasOwnProperty(ef.type)) {
			acc.push({type: ef.type, baseDuration: skill.baseDuration / 10000, modifier: ef.modifier / 10000});
		}
		return acc;
	}, []);
}

export function buildSkillData(horse: HorseParameters, course: CourseData, wholeCourse: RegionList, conditions: typeof Conditions, skillId: string) {
	if (!(skillId in skills)) {
		throw new Error('bad skill ID ' + skillId);
	}
	const alternatives = skills[skillId].alternatives;
	for (let i = 0; i < alternatives.length; ++i) {
		const skill = alternatives[i];
		if (skill.precondition) {
			const pre = parse(tokenize(skill.precondition), {conditions});
			if (pre.apply(wholeCourse, course, horse)[0].length == 0) {
				continue;
			}
		}
		const op = parse(tokenize(skill.condition), {conditions});
		const [regions, extraCondition] = op.apply(wholeCourse, course, horse);
		if (regions.length == 0) {
			continue;
		}
		const effects = buildSkillEffects(skill);
		if (effects.length > 0) {
			const rarity = skills[skillId].rarity;
			return {
				skillId: skillId,
				// for some reason 1*/2* uniques, 1*/2* upgraded to 3*, and naturally 3* uniques all have different rarity (3, 4, 5 respectively)
				rarity: rarity >= 3 && rarity <= 5 ? 3 : rarity,
				samplePolicy: op.samplePolicy,
				regions: regions,
				extraCondition: extraCondition,
				effects: effects
			};
		} else {
			return null;
		}
	}
	// if we get here, it means that no alternatives have their conditions satisfied for this course/horse.
	// however, for purposes of summer goldship unique (Adventure of 564), we still have to add something, since
	// that could still cause them to activate. so just add the first alternative at a location after the course
	// is over with a constantly false dynamic condition so that it never activates normally.
	const effects = buildSkillEffects(alternatives[0]);
	if (effects.length == 0) {
		return null;
	} else {
		const afterEnd = new RegionList();
		afterEnd.push(new Region(9999,9999));
		return {
			skillId: skillId,
			rarity: Math.min(skills[skillId].rarity, 3),
			samplePolicy: ImmediatePolicy,
			regions: afterEnd,
			extraCondition: (_) => false,
			effects: effects
		};
	}
}

const conditionsWithActivateCountsAsRandom = Object.freeze(Object.assign({}, Conditions, {
	activate_count_end_after: random({
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters) {
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 2), CourseHelpers.phaseEnd(course.distance, 3));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	activate_count_later_half: random({
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters) {
			const bounds = new Region(course.distance / 2, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	activate_count_middle: random({
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters) {
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 1), CourseHelpers.phaseEnd(course.distance, 1));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	activate_count_start: immediate({  // for 地固め
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters) {
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 0), CourseHelpers.phaseEnd(course.distance, 0));
			return regions.rmap(r => r.intersect(bounds));
		}
	})
}));

export class RaceSolverBuilder {
	_course: CourseData | null
	_ground: GroundCondition
	_mood: Mood
	_horse: HorseDesc | null
	_pacer: HorseDesc | null
	_pacerSkills: PendingSkill[]
	_rng: Rule30CARng
	_conditions: typeof Conditions
	_skills: string[]
	_extraSkillHooks: ((skilldata: SkillData[], horse: HorseParameters, course: CourseData) => void)[]

	constructor(readonly nsamples: number) {
		this._course = null;
		this._ground = GroundCondition.Good;
		this._mood = 2;
		this._horse = null;
		this._pacer = null;
		this._pacerSkills = [];
		this._rng = new Rule30CARng(Math.floor(Math.random() * (-1 >>> 0)) >>> 0);
		this._conditions = Conditions;
		this._skills = [];
		this._extraSkillHooks = [];
	}

	seed(seed: number) {
		this._rng = new Rule30CARng(seed);
		return this;
	}

	course(course: number | CourseData) {
		if (typeof course == 'number') {
			this._course = CourseHelpers.getCourse(course);
		} else {
			this._course = course;
		}
		return this;
	}

	ground(ground: GroundCondition) {
		this._ground = ground;
		return this;
	}

	mood(mood: Mood) {
		this._mood = mood;
		return this;
	}

	horse(horse: HorseDesc) {
		this._horse = horse;
		return this;
	}

	pacer(horse: HorseDesc) {
		this._pacer = horse;
		return this;
	}

	_isNige() {
		if (typeof this._horse.strategy == 'string') {
			return this._horse.strategy.toUpperCase() == 'NIGE' || this._horse.strategy.toUpperCase() == 'OONIGE';
		} else {
			return this._horse.strategy == Strategy.Nige || this._horse.strategy == Strategy.Oonige;
		}
	}

	useDefaultPacer(openingLegAccel: boolean = false) {
		if (this._isNige()) {
			return this;
		}

		this._pacer = Object.assign({}, this._horse, {strategy: 'Nige'});
		if (openingLegAccel) {
			// top is jiga and bottom is white sente
			// arguably it's more realistic to include these, but also a lot of the time they prevent the exact pace down effects
			// that we're trying to investigate
			this._pacerSkills = [{
				skillId: '201601',
				rarity: SkillRarity.White,
				trigger: new Region(0, 100),
				extraCondition: (_) => true,
				effects: [{type: SkillType.Accel, baseDuration: 3.0, modifier: 0.2}]
			}, {
				skillId: '200532',
				rarity: SkillRarity.White,
				trigger: new Region(0, 100),
				extraCondition: (_) => true,
				effects: [{type: SkillType.Accel, baseDuration: 1.2, modifier: 0.2}]
			}];
		}
		return this;
	}

	withActivateCountsAsRandom() {
		this._conditions = conditionsWithActivateCountsAsRandom;
		return this;
	}

	// NB. must be called after horse and mood are set
	withAsiwotameru() {
		// for some reason, asitame (probably??) uses *displayed* power adjusted for motivation + greens
		const baseDisplayedPower = this._horse.power * (1 + 0.02 * this._mood);
		this._extraSkillHooks.push((skilldata, horse, course) => {
			const power = skilldata.reduce((acc,sd) => {
				const powerUp = sd.effects.find(ef => ef.type == SkillType.PowerUp);
				if (powerUp && sd.regions.length > 0) {
					return acc + powerUp.modifier;
				} else {
					return acc;
				}
			}, baseDisplayedPower);

			if (power > 1200) {
				const spurtStart = new RegionList();
				spurtStart.push(new Region(CourseHelpers.phaseStart(course.distance, 2), course.distance));
				skilldata.push({
					skillId: 'asitame',
					rarity: SkillRarity.White,
					regions: spurtStart,
					samplePolicy: ImmediatePolicy,
					extraCondition: (_) => true,
					effects: [{
						type: SkillType.Accel,
						baseDuration: 3.0 / (course.distance / 1000.0),
						modifier: Asitame.calcApproximateModifier(power, horse.strategy, course.distanceType)
					}]
				});
			}
		});
		return this;
	}

	addSkill(skillId: string) {
		this._skills.push(skillId);
		return this;
	}

	fork() {
		const clone = new RaceSolverBuilder(this.nsamples);
		clone._course = this._course;
		clone._ground = this._ground;
		clone._mood = this._mood;
		clone._horse = this._horse;
		clone._pacer = this._pacer;
		clone._pacerSkills = this._pacerSkills.slice();  // sharing the skill objects is fine but see the note below
		clone._rng = new Rule30CARng(this._rng.lo, this._rng.hi);
		clone._conditions = this._conditions;
		clone._skills = this._skills.slice();

		// NB. GOTCHA: if asitame is enabled, it closes over *our* horse and mood data, and not the clone's
		// this is assumed to be fine, since fork() is intended to be used after everything is added except skills,
		// but it does mean that if you want to compare different power stats or moods, you must call withAsiwotameru()
		// after fork() on each instance separately, which is a potential gotcha
		clone._extraSkillHooks = this._extraSkillHooks.slice();
		return clone;
	}

	*build() {
		let horse = buildBaseStats(this._horse, this._mood);
		const solverRng = new Rule30CARng(this._rng.int32());
		const pacerRng = new Rule30CARng(this._rng.int32());  // need this even if _pacer is null in case we forked from/to something with a pacer
		                                                      // (to keep the rngs in sync)

		const pacerHorse = this._pacer ? buildAdjustedStats(buildBaseStats(this._pacer, this._mood), this._course, this._ground) : null;

		const wholeCourse = new RegionList();
		wholeCourse.push(new Region(0, this._course.distance));
		Object.freeze(wholeCourse);

		const makeSkill = buildSkillData.bind(null, horse, this._course, wholeCourse, this._conditions) as (s: string) => SkillData | null;
		const skilldata = this._skills.map(makeSkill).filter(s => s != null);
		this._extraSkillHooks.forEach(h => h(skilldata, horse, this._course));
		const triggers = skilldata.map(sd => sd.samplePolicy.sample(sd.regions, this.nsamples, this._rng));

		// must come after skill activations are decided because conditions like base_power depend on base stats
		horse = buildAdjustedStats(horse, this._course, this._ground);

		for (let i = 0; i < this.nsamples; ++i) {
			const skills = skilldata.map((sd,sdi) => ({
				skillId: sd.skillId,
				rarity: sd.rarity,
				trigger: triggers[sdi][i % triggers[sdi].length],
				extraCondition: sd.extraCondition,
				effects: sd.effects
			}));

			// NOTE: it is highly important that summer goldship unique never gets added to a pacer
			// that can cause triggers to be mutated, and we reuse the triggers every iteration of this loop
			// this is currently safe because 1) we know for sure there is no summer goldship unique here and 2) we only have white skills,
			// and it only mutates the trigger on gold skills.
			// however if a way for a user to add to _pacerSkills is ever added, this probably needs to be updated to copy triggers
			const pacer = pacerHorse ? new RaceSolver({horse: pacerHorse, course: this._course, skills: this._pacerSkills, rng: pacerRng}) : null;

			yield new RaceSolver({horse, course: this._course, skills, pacer, rng: solverRng});
		}
	}
}
