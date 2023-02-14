const assert = require('assert').strict;

import { Strategy, Aptitude, HorseParameters, StrategyHelpers } from './HorseTypes';
import { CourseData, CourseHelpers, Phase } from './CourseData';
import { Region } from './Region';
import { PRNG, Rule30CARng } from './Random';

namespace Speed {
	export const StrategyPhaseCoefficient = Object.freeze([
		[], // strategies start numbered at 1
		[1.0, 0.98, 0.962],
		[0.978, 0.991, 0.975],
		[0.938, 0.998, 0.994],
		[0.931, 1.0, 1.0],
		[1.063, 0.962, 0.95]
	].map(a => Object.freeze(a)));
	export const DistanceProficiencyModifier = Object.freeze([1.05, 1.0, 0.9, 0.8, 0.6, 0.4, 0.2, 0.1]);
}

function baseSpeed(course: CourseData) {
	return 20.0 - (course.distance - 2000) / 1000.0;
}

function baseTargetSpeed(horse: HorseParameters, course: CourseData, phase: Phase) {
	return baseSpeed(course) * Speed.StrategyPhaseCoefficient[horse.strategy][phase] +
		+(phase == 2) * Math.sqrt(500.0 * horse.speed) *
		Speed.DistanceProficiencyModifier[horse.distanceAptitude] *
		0.002;
}

function lastSpurtSpeed(horse: HorseParameters, course: CourseData) {
	return (baseTargetSpeed(horse, course, 2) + 0.01 * baseSpeed(course)) * 1.05 +
		Math.sqrt(500.0 * horse.speed) * Speed.DistanceProficiencyModifier[horse.distanceAptitude] * 0.002 +
		Math.pow(450.0 * horse.guts, 0.597) * 0.0001;
}

namespace Acceleration {
	export const StrategyPhaseCoefficient = Object.freeze([
		[],
		[1.0, 1.0, 0.996],
		[0.985, 1.0, 0.996],
		[0.975, 1.0, 1.0],
		[0.945, 1.0, 0.997],
		[1.17, 0.94, 0.956]
	].map(a => Object.freeze(a)));
	export const GroundTypeProficiencyModifier = Object.freeze([1.05, 1.0, 0.9, 0.8, 0.7, 0.5, 0.3, 0.1]);
	export const DistanceProficiencyModifier = Object.freeze([1.0, 1.0, 1.0, 1.0, 1.0, 0.6, 0.5, 0.4]);
}

const BaseAccel = 0.0006;
const UphillBaseAccel = 0.0004;

function baseAccel(baseAccel: number, horse: HorseParameters, phase: Phase) {
	return baseAccel * Math.sqrt(500.0 * horse.power) *
	  Acceleration.StrategyPhaseCoefficient[horse.strategy][phase] *
	  Acceleration.GroundTypeProficiencyModifier[horse.surfaceAptitude] *
	  Acceleration.DistanceProficiencyModifier[horse.distanceAptitude];
}

const PhaseDeceleration = [-1.2, -0.8, -1.0];

namespace PositionKeep {
	export const BaseMinimumThreshold = Object.freeze([0, 0, 3.0, 6.5, 7.5]);
	export const BaseMaximumThreshold = Object.freeze([0, 0, 5.0, 7.0, 8.0]);

	export function courseFactor(distance: number) {
		return 0.0008 * (distance - 1000) + 1.0;
	}

	export function minThreshold(strategy: Strategy, distance: number) {
		// senkou minimum threshold is a constant 3.0 independent of the course factor for some reason
		return BaseMinimumThreshold[strategy] * (strategy == Strategy.Senkou ? 1.0 : courseFactor(distance));
	}

	export function maxThreshold(strategy: Strategy, distance: number) {
		return BaseMaximumThreshold[strategy] * courseFactor(distance);
	}
}

// these are commonly initialized with a negative number and then checked >= 0 to see if a duration is up
// (the reason for doing that instead of initializing with 0 and then checking against the duration is if
// the code that checks for the duration expiring is separate from the code that initializes the timer and
// has to deal with different durations)
export class Timer {
	constructor(public t: number) {}
}

export interface RaceState {
	readonly accumulatetime: Readonly<Timer>
	readonly activateCount: readonly number[]
	readonly activateCountHeal: number
}

export type DynamicCondition = (state: RaceState) => boolean;

export const enum SkillType {
	SpeedUp = 1,
	StaminaUp = 2,
	PowerUp = 3,
	GutsUp = 4,
	WisdomUp = 5,
	Recovery = 9,
	CurrentSpeed = 22,
	TargetSpeed = 27,
	Accel = 31,
	ActivateRandomGold = 37
}

export const enum SkillRarity { White = 1, Gold, Unique }

export interface SkillEffect {
	type: SkillType
	baseDuration: number
	modifier: number
}

export interface PendingSkill {
	skillId: string
	rarity: SkillRarity
	trigger: Region
	extraCondition: DynamicCondition
	effects: SkillEffect[]
}

interface ActiveSkill {
	skillId: string
	durationTimer: Timer
	modifier: number
}

function noop(x: unknown) {}

export class RaceSolver {
	accumulatetime: Timer
	pos: number
	minSpeed: number
	currentSpeed: number
	targetSpeed: number
	accel: number
	horse: { -readonly[P in keyof HorseParameters]: HorseParameters[P] }
	course: CourseData
	rng: PRNG
	gorosiRng: PRNG
	paceEffectRng: PRNG
	timers: Timer[]
	startDash: boolean
	phase: Phase
	nextPhaseTransition: number
	activeSpeedSkills: ActiveSkill[]
	activeAccelSkills: ActiveSkill[]
	pendingSkills: PendingSkill[]
	currentSpeedModifier: number
	nHills: number
	hillIdx: number
	hillStart: number[]
	hillEnd: number[]
	activateCount: number[]
	activateCountHeal: number
	onSkillActivate: (s: RaceSolver, skillId: string) => void
	onSkillDeactivate: (s: RaceSolver, skillId: string) => void
	sectionLength: number
	pacer: RaceSolver | null
	isPaceDown: boolean
	posKeepMinThreshold: number
	posKeepMaxThreshold: number
	posKeepCooldown: Timer
	posKeepEnd: number
	posKeepSpeedCoef: number
	posKeepEffectStart: number
	posKeepEffectExitDistance: number
	updatePositionKeep: () => void

	constructor(params: {
		horse: HorseParameters,
		course: CourseData,
		rng: PRNG,
		skills: PendingSkill[],
		pacer?: RaceSolver,
		onSkillActivate?: (s: RaceSolver, skillId: string) => void,
		onSkillDeactivate?: (s: RaceSolver, skillId: string) => void
	}) {
		// clone since green skills may modify the stat values
		this.horse = Object.assign({}, params.horse);
		this.course = params.course;
		this.pacer = params.pacer || null;
		this.rng = params.rng;
		this.pendingSkills = params.skills.slice();  // copy since we remove from it
		this.gorosiRng = new Rule30CARng(this.rng.int32());
		this.paceEffectRng = new Rule30CARng(this.rng.int32());
		this.timers = [];
		this.accumulatetime = this.getNewTimer();
		this.phase = 0;
		this.nextPhaseTransition = CourseHelpers.phaseStart(this.course.distance, 1);
		this.activeSpeedSkills = [];
		this.activeAccelSkills = [];
		this.currentSpeedModifier = 0.0;
		this.activateCount = [0,0,0];
		this.activateCountHeal = 0;
		this.onSkillActivate = params.onSkillActivate || noop;
		this.onSkillDeactivate = params.onSkillDeactivate || noop;
		this.sectionLength = this.course.distance / 24.0;
		this.isPaceDown = false;
		this.posKeepMinThreshold = PositionKeep.minThreshold(this.horse.strategy, this.course.distance);
		this.posKeepMaxThreshold = PositionKeep.maxThreshold(this.horse.strategy, this.course.distance);
		this.posKeepCooldown = this.getNewTimer();
		// NB. in the actual game, position keep continues for 10 sections. however we're really only interested in pace down at
		// the beginning, which is somewhat predictable. arbitrarily cap at 5.
		this.posKeepEnd = this.sectionLength * 5.0;
		this.posKeepSpeedCoef = 1.0;
		if (StrategyHelpers.strategyMatches(this.horse.strategy, Strategy.Nige) || this.pacer == null) {
			this.updatePositionKeep = noop as any;
		} else {
			this.updatePositionKeep = this.updatePositionKeepNonNige;
		}

		this.initHills();

		this.pos = 0.0;
		this.accel = 0.0;
		this.currentSpeed = 3.0;
		this.targetSpeed = 0.85 * baseSpeed(this.course);
		this.processSkillActivations();  // activate gate skills (must come before setting minimum speed because green skills can modify guts)
		this.minSpeed = 0.85 * baseSpeed(this.course) + Math.sqrt(200.0 * this.horse.guts) * 0.001;
		this.startDash = true;
	}

	initHills() {
		// note that slopes are not always sorted by start location in course_data.json
		// sometimes (?) they are sorted by hill type and then by start
		// require this here because the code relies on encountering them sequentially
		assert(CourseHelpers.isSortedByStart(this.course.slopes), 'slopes must be sorted by start location');

		this.nHills = this.course.slopes.length;
		this.hillStart = this.course.slopes.map(s => s.start).reverse();
		this.hillEnd = this.course.slopes.map(s => s.start + s.length).reverse();
		this.hillIdx = -1;
		if (this.hillStart.length > 0 && this.hillStart[this.hillStart.length - 1] == 0) {
			if (this.course.slopes[0].slope > 0) {
				this.hillIdx = 0;
			} else {
				this.hillEnd.pop();
			}
			this.hillStart.pop();
		}
	}

	getNewTimer(t: number = 0) {
		const tm = new Timer(t);
		this.timers.push(tm);
		return tm;
	}

	getMaxSpeed() {
		if (this.startDash) {
			// target speed can be below 0.85 * BaseSpeed for non-runners if there is a hill at the start of the course
			// in this case you actually don't exit start dash until your target speed is high enough to be over 0.85 * BaseSpeed
			return Math.min(this.targetSpeed, 0.85 * baseSpeed(this.course));
		} else  if (this.currentSpeed > this.targetSpeed) {
			return 9999.0;  // allow decelerating if targetSpeed drops
		} else {
			return this.targetSpeed;
		}
		// technically, there's a hard cap of 30m/s, but there's no way to actually hit that without implementing the Pace Up Ex position keep mode
	}

	step(dt: number) {
		// velocity verlet integration
		// do this half-step update of velocity (halfv) because during the start dash acceleration depends on velocity
		// (ie, velocity is given by the following system of differential equations)
		//
		// x′(t + Δt) = x′(t) + Δt * x′′(t + Δt)
		//               ⎧ baseAccel(horse) + accelSkillModifier + 24.0	if x′(t) < 0.85 * baseSpeed(course)
		// x′′(t + Δt) = ⎨
		//               ⎩ baseAccel(horse) + accelSkillModifier		if x′(t) ≥ 0.85 * baseSpeed(course)
		//
		// i dont actually know anything about numerical analysis but i saw this on the internet

		if (this.pos < this.posKeepEnd && this.pacer != null) {
			this.pacer.step(dt);
		}

		const halfv = Math.min(this.currentSpeed + 0.5 * dt * this.accel, this.getMaxSpeed());
		this.pos += halfv * dt;
		this.timers.forEach(tm => tm.t += dt);
		this.updateHills();
		this.updatePhase();
		this.processSkillActivations();
		this.updatePositionKeep();
		this.updateTargetSpeed();
		this.applyForces();
		this.currentSpeed = Math.min(halfv + 0.5 * dt * this.accel + this.currentSpeedModifier, this.getMaxSpeed());
		if (!this.startDash && this.currentSpeed < this.minSpeed) {
			this.currentSpeed = this.minSpeed;
		} else if (this.startDash && this.currentSpeed >= 0.85 * baseSpeed(this.course)) {
			this.startDash = false;
		}
		this.currentSpeedModifier = 0.0;
	}

	updatePositionKeepNonNige() {
		if (this.pos >= this.posKeepEnd) {
			this.isPaceDown = false;
			this.posKeepSpeedCoef = 1.0;
			this.updatePositionKeep = noop as any;
		} else if (this.isPaceDown) {
			if (
			   this.pacer.pos - this.pos > this.posKeepEffectExitDistance
			|| this.pos - this.posKeepEffectStart > this.sectionLength
			|| this.activeSpeedSkills.length > 0
			) {
				this.isPaceDown = false;
				this.posKeepCooldown.t = -3.0;
				this.posKeepSpeedCoef = 1.0;
			}
		} else if (this.pacer.pos - this.pos < this.posKeepMinThreshold && this.activeSpeedSkills.length == 0 && this.posKeepCooldown.t >= 0) {
			this.isPaceDown = true;
			this.posKeepEffectStart = this.pos;
			const min = this.posKeepMinThreshold;
			const max = this.phase == 1 ? min + 0.5 * (this.posKeepMaxThreshold - min) : this.posKeepMaxThreshold;
			this.posKeepEffectExitDistance = min + this.paceEffectRng.random() * (max - min);
			this.posKeepSpeedCoef = this.phase == 1 ? 0.945 : 0.915;
		}
	}

	updateTargetSpeed() {
		if (this.phase == 2) {
			this.targetSpeed = lastSpurtSpeed(this.horse, this.course);
		} else {
			this.targetSpeed = baseTargetSpeed(this.horse, this.course, this.phase) * this.posKeepSpeedCoef;
		}
		this.targetSpeed += this.activeSpeedSkills.reduce((a,b) => a + b.modifier, 0);

		if (this.hillIdx != -1) {
			this.targetSpeed -= this.course.slopes[this.hillIdx].slope / 10000.0 * 200.0 / this.horse.power;
			this.targetSpeed = Math.max(this.targetSpeed, this.minSpeed);
		}
	}

	applyForces() {
		if (this.currentSpeed > this.targetSpeed) {
			this.accel = this.isPaceDown ? -0.5 : PhaseDeceleration[this.phase];
			return;
		}
		this.accel = baseAccel(this.hillIdx != -1 ? UphillBaseAccel : BaseAccel, this.horse, this.phase);
		if (this.startDash) {
			this.accel += 24.0;
		}
		this.accel += this.activeAccelSkills.reduce((a,b) => a + b.modifier, 0);
	}

	updateHills() {
		if (this.hillIdx == -1 && this.hillStart.length > 0 && this.pos >= this.hillStart[this.hillStart.length - 1]) {
			if (this.course.slopes[this.nHills - this.hillStart.length].slope > 0) {
				this.hillIdx = this.nHills - this.hillStart.length;
			} else {
				this.hillEnd.pop();
			}
			this.hillStart.pop();
		} else if (this.hillIdx != -1 && this.hillEnd.length > 0 && this.pos > this.hillEnd[this.hillEnd.length - 1]) {
			this.hillIdx = -1;
			this.hillEnd.pop();
		}
	}

	updatePhase() {
		// NB. there is actually a phase 3 which starts at 5/6 distance, but for purposes of
		// strategy phase modifiers, activate_count_end_after, etc it is the same as phase 2
		// and it's easier to treat them together, so cap phase at 2.
		if (this.pos >= this.nextPhaseTransition && this.phase < 2) {
			++this.phase;
			this.nextPhaseTransition = CourseHelpers.phaseStart(this.course.distance, this.phase + 1 as Phase);
		}
	}

	processSkillActivations() {
		for (let i = this.activeSpeedSkills.length; --i >= 0;) {
			const s = this.activeSpeedSkills[i];
			if (s.durationTimer.t >= 0) {
				this.activeSpeedSkills.splice(i,1);
				this.onSkillDeactivate(this, s.skillId);
			}
		}
		for (let i = this.activeAccelSkills.length; --i >= 0;) {
			const s = this.activeAccelSkills[i];
			if (s.durationTimer.t >= 0) {
				this.activeAccelSkills.splice(i,1);
				this.onSkillDeactivate(this, s.skillId);
			}
		}
		for (let i = this.pendingSkills.length; --i >= 0;) {
			const s = this.pendingSkills[i];
			if (this.pos >= s.trigger.end) {  // NB. `Region`s are half-open [start,end) intervals. If pos == end we are out of the trigger.
				// skill failed to activate
				this.pendingSkills.splice(i,1);
			} else if (this.pos >= s.trigger.start && s.extraCondition(this)) {
				this.activateSkill(s);
				this.pendingSkills.splice(i,1);
			}
		}
	}

	activateSkill(s: PendingSkill) {
		s.effects.forEach(ef => {
			const scaledDuration = ef.baseDuration * this.course.distance / 1000;
			switch (ef.type) {
			case SkillType.SpeedUp:
				this.horse.speed = Math.max(this.horse.speed + ef.modifier, 1);
				break;
			case SkillType.StaminaUp:
				this.horse.stamina = Math.max(this.horse.stamina + ef.modifier, 1);
				break;
			case SkillType.PowerUp:
				this.horse.power = Math.max(this.horse.power + ef.modifier, 1);
				break;
			case SkillType.GutsUp:
				this.horse.guts = Math.max(this.horse.guts + ef.modifier, 1);
				break;
			case SkillType.WisdomUp:
				this.horse.wisdom = Math.max(this.horse.wisdom + ef.modifier, 1);
				break;
			case SkillType.TargetSpeed:
				this.activeSpeedSkills.push({skillId: s.skillId, durationTimer: this.getNewTimer(-scaledDuration), modifier: ef.modifier});
				break;
			case SkillType.Accel:
				this.activeAccelSkills.push({skillId: s.skillId, durationTimer: this.getNewTimer(-scaledDuration), modifier: ef.modifier});
				break;
			case SkillType.CurrentSpeed:
				this.currentSpeedModifier += ef.modifier;
				break;
			case SkillType.Recovery:
				++this.activateCountHeal;
				break;
			case SkillType.ActivateRandomGold:
				this.doActivateRandomGold(ef.modifier);
				break;
			}
		});
		++this.activateCount[this.phase];
		this.onSkillActivate(this, s.skillId);
	}

	doActivateRandomGold(ngolds: number) {
		const goldIndices = this.pendingSkills.reduce((acc, skill, i) => {
			if (skill.rarity == SkillRarity.Gold && skill.effects.every(ef => ef.type > SkillType.WisdomUp)) acc.push(i);
			return acc;
		}, []);
		for (let i = goldIndices.length; --i >= 0;) {
			const j = this.gorosiRng.uniform(i + 1);
			[goldIndices[i], goldIndices[j]] = [goldIndices[j], goldIndices[i]];
		}
		for (let i = 0; i < Math.min(ngolds, goldIndices.length); ++i) {
			this.activateSkill(this.pendingSkills[goldIndices[i]]);
			// important: we can't actually remove this from pendingSkills directly, since this function runs inside the loop in
			// processSkillActivations. modifying the pendingSkills array here would mess up that loop. instead, by setting its
			// trigger to 0, we ensure that the skill won't activate again and will be cleaned up either later in the loop or
			// the next time processSkillActivations is called.
			// this is a bit of a hack and i don't like it very much
			// NB. this mutation could be visible outside of RaceSolver, since the caller constructs the initial PendingSkill
			// objects and sets their triggers. currently, that doesn't matter since nothing uses them after the solver runs,
			// but it should be assumed by callers that once added to pendingSkills RaceSolver owns the skill object and the
			// caller shouldn't rely on it being the same.
			// this means, for example, the same PendingSkill object can't be added to two different RaceSolvers
			// frankly this seems exceptionally error-prone and i'm sure it's going to bite me with some hard-to-diagnose bug
			// at some point. TODO find a better way to deal with this
			this.pendingSkills[goldIndices[i]].trigger = new Region(0,0);
		}
	}
}
