import { Strategy, Aptitude, HorseParameters } from './HorseTypes';
import { CourseData, CourseHelpers, Surface, Phase } from './CourseData';

const enum SkillType { TargetSpeed, Accel, CurrentSpeed }

interface SkillData {
	name: string
	type: SkillType
	baseDuration: number
	modifier: number
}

namespace Speed {
	export const StrategyPhaseCoefficient = Object.freeze([
		[1.0, 0.98, 0.962],
		[0.978, 0.991, 0.975],
		[0.938, 0.998, 0.994],
		[0.931, 1.0, 1.0],
		[1.063, 0.962, 0.95]
	].map(a => Object.freeze(a)));
	export const DistanceProficiencyModifier = Object.freeze([1.05, 1.0, 0.9, 0.8, 0.6, 0.4, 0.2, 0.1]);
}

function baseSpeed(course: CourseData) {
	return 20.0 - (course.distance - 2000) / 1000;
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

function baseAccel(baseAccel: number, horse: HorseParameters) {
	return baseAccel * Math.sqrt(500.0 * horse.power) *
	  Acceleration.StrategyPhaseCoefficient[horse.strategy][2] *
	  Acceleration.GroundTypeProficiencyModifier[horse.surfaceAptitude] *
	  Acceleration.DistanceProficiencyModifier[horse.distanceAptitude];
}

function decel(pos: number, distance: number) {
	if (pos >= distance * 2/3) return -1.0;
	else if (pos >= distance * 1/6) return -0.8;
	else return -1.2;
}

export class RaceIntegrator {
	accumulatetime: number
	pos: number
	minSpeed: number
	currentSpeed: number
	targetSpeed: number
	accel: number
	horse: HorseParameters
	course: CourseData
	startDash: boolean
	activeSpeedSkills: {remainingDuration: number, skill: SkillData}[]
	activeAccelSkills: {remainingDuration: number, skill: SkillData}[]
	pendingSkills: {activationPoint: number, skill: SkillData}[]
	currentSpeedModifier: number
	nHills: number
	hillIdx: number
	hillStart: number[]
	hillEnd: number[]

	constructor(horse: HorseParameters, course: CourseData) {
		this.horse = horse;
		this.course = course;
		this.accumulatetime = 0.0;
		this.pos = 0.0;
		this.accel = 0.0;
		this.currentSpeed = 0.0;
		this.targetSpeed = 0.85 * baseSpeed(course);
		this.minSpeed = this.targetSpeed + Math.sqrt(200.0 * horse.guts) * 0.001;
		this.startDash = true;
		this.activeSpeedSkills = [];
		this.activeAccelSkills = [];
		this.pendingSkills = [];
		this.currentSpeedModifier = 0.0;
		this.initHills();
	}

	initHills() {
		// note that slopes are not always sorted by start location in course_data.json
		// sometimes (?) they are sorted by hill type and then by start
		// require this here because the code relies on encountering them sequentially
		if (!CourseHelpers.isSortedByStart(this.course.slopes)) {
			throw new Error('slopes must be sorted by start location');
		}

		this.nHills = this.course.slopes.length;
		this.hillStart = this.course.slopes.map(s => s.start).reverse();
		this.hillEnd = this.course.slopes.map(s => s.start + s.length).reverse();
		this.hillIdx = -1;
		if (this.hillStart.length > 0 && this.hillStart[this.hillStart.length - 1] == 0) {
			if (CourseHelpers.slopePer(this.course, 0) > 1.0) {
				this.hillIdx = 0;
			} else {
				this.hillEnd.pop();
			}
			this.hillStart.pop();
		}
	}

	step(dt: number) {
		// velocity verlet integration
		// do this half-step update of velocity (halfv) because during the start dash acceleration depends on velocity
		// (ie, velocity is given by the following system of differential equations)
		//
		// x′(t) = x′(t - Δt) + Δt * x′′(t)
		//          ⎧ baseAccel(horse) + accelSkillModifier + 24.0	if x′(t) < 0.85 * baseSpeed(course)
		// x′′(t) = ⎨
		//          ⎩ baseAccel(horse) + accelSkillModifier			if x′(t) ≥ 0.85 * baseSpeed(course)
		//
		// i dont actually know anything about numerical analysis but i saw this on the internet

		let targetSpeed = this.currentSpeed > this.targetSpeed ? 9999 : this.targetSpeed;  // allow decelerating if targetSpeed drops
		const halfv = Math.min(this.currentSpeed + 0.5 * dt * this.accel, targetSpeed);
		this.pos += halfv * dt;
		this.accumulatetime += dt;
		this.updateHills();
		this.processSkillActivations(dt);
		this.updateTargetSpeed();
		this.applyForces();
		targetSpeed = this.currentSpeed > this.targetSpeed ? 9999 : this.targetSpeed;
		this.currentSpeed = Math.min(halfv + 0.5 * dt * this.accel + this.currentSpeedModifier, targetSpeed);
		if (!this.startDash && this.currentSpeed < this.minSpeed) {
			this.currentSpeed = this.minSpeed;
		}
		this.currentSpeedModifier = 0.0;
	}

	updateTargetSpeed() {
		if (this.pos >= this.course.distance * 2/3) {
			this.targetSpeed = lastSpurtSpeed(this.horse, this.course);
		} else if (this.pos >= this.course.distance * 1/6) {
			this.targetSpeed = baseTargetSpeed(this.horse, this.course, 1);
		} else if (!this.startDash) {
			this.targetSpeed = baseTargetSpeed(this.horse, this.course, 0);
		}
		if (!this.startDash) {
			this.targetSpeed += this.activeSpeedSkills.reduce((a,b) => a + b.skill.modifier, 0);
		}
		if (this.hillIdx != -1) {
			this.targetSpeed -= CourseHelpers.slopePer(this.course, this.hillIdx) * 200 / this.horse.power;
		}
	}

	applyForces() {
		if (this.currentSpeed > this.targetSpeed) {
			this.accel = decel(this.pos, this.course.distance);
			return;
		}
		this.accel = baseAccel(this.hillIdx != -1 ? UphillBaseAccel : BaseAccel, this.horse);
		if (this.startDash && this.currentSpeed >= this.targetSpeed) {
			this.startDash = false;
		}
		if (this.startDash) {
			this.accel += 24.0;
		}
		this.accel += this.activeAccelSkills.reduce((a,b) => a + b.skill.modifier, 0);
	}

	updateHills() {
		if (this.hillIdx == -1 && this.hillStart.length > 0 && this.pos >= this.hillStart[this.hillStart.length - 1]) {
			if (CourseHelpers.slopePer(this.course, this.nHills - this.hillStart.length) > 1.0) {
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

	processSkillActivations(dt: number) {
		for (var i = this.activeSpeedSkills.length; --i >= 0;) {
			const s = this.activeSpeedSkills[i];
			if ((s.remainingDuration -= dt) <= 0) {
				this.activeSpeedSkills.splice(i,1);
			}
		}
		for (var i = this.activeAccelSkills.length; --i >= 0;) {
			const s = this.activeAccelSkills[i];
			if ((s.remainingDuration -= dt) <= 0) {
				this.activeAccelSkills.splice(i,1);
			}
		}
		for (var i = this.pendingSkills.length; --i >= 0;) {
			const s = this.pendingSkills[i];
			if (this.pos >= s.activationPoint) {
				const scaledDuration = s.skill.baseDuration * this.course.distance / 1000;
				switch (s.skill.type) {
				case SkillType.TargetSpeed:
					this.activeSpeedSkills.push({remainingDuration: scaledDuration, skill: s.skill});
					break;
				case SkillType.Accel:
					this.activeAccelSkills.push({remainingDuration: scaledDuration, skill: s.skill});
					break;
				case SkillType.CurrentSpeed:
					this.currentSpeedModifier += s.skill.modifier;
					break;
				}
				this.pendingSkills.splice(i,1);
			}
		}
	}
}

const uma: HorseParameters = {
    speed: 1200*1.04*1.2,
    stamina: 800*1.04,
    power: 1100*1.04,
    guts: 1100*1.04,
    int: 1100*1.04,
    strategy: Strategy.Sasi,
    distanceAptitude: Aptitude.S,
    surfaceAptitude: Aptitude.A
};

import tracks from '../course_data.json';
import {Conditions, Region, RegionList} from './ActivationConditions';
import {parse, tokenize} from './ParseConditions';

const course = tracks['10009'].courses['10906']; // hansin 2200
//const course = tracks['10006'].courses['10602']; // tokyo 1600

course.slopes.sort((a,b) => a.start - b.start);
course.slopes.pop();

const nsg = {activationPoint: course.distance*2/3, skill: {name: 'nsg', type: SkillType.Accel, baseDuration: 3, modifier: 0.4}};
const bariki = {activationPoint: 295, skill: {name: 'bariki', type: SkillType.TargetSpeed, baseDuration: 2.4, modifier: 0.15}};

const f = new RegionList();
f.push(new Region(0, course.distance));
//const op = parse(tokenize('distance_type==3&phase_random==2&order_rate>50'));
//const op = parse(tokenize('running_style==3&phase_random==1'));
const op = parse(tokenize('distance_type==3&phase_random==1&order_rate>50'));
const samples = op.samplePolicy.sample(op.apply(f, course, uma), 500);

//const op_dober = parse(tokenize('distance_rate>=60&slope==2&phase==1&order_rate>=40&order_rate<=80&remain_distance>=500'));
//const op_dia = parse(tokenize('is_last_straight_onetime==1&order>=2&order<=5&distance_diff_top<=5'));
//const pos_dober = op_dober.samplePolicy.sample(op_dober.apply(f, course, uma), 1)[0];
//const pos_dia = op_dia.samplePolicy.sample(op_dia.apply(f, course, uma), 1)[0];

const gain = [];
for (var i = 0; i < samples.length; ++i) {

const pos = samples[i];

const s = new RaceIntegrator(uma, course);
s.pendingSkills.push(nsg);
s.pendingSkills.push({activationPoint: pos, skill: {name: 'inazuma step', type: SkillType.Accel, baseDuration: 4, modifier: 0.2}});
//s.pendingSkills.push({activationPoint: pos_dober, skill: {name: 'alt dober', type: SkillType.TargetSpeed, baseDuration: 5, modifier: 0.35}});
//s.pendingSkills.push({activationPoint: pos, skill: {name: 'ikuno gold', type: SkillType.TargetSpeed, baseDuration: 2.4, modifier: 0.45}});
//s.pendingSkills.push({activationPoint: course.distance - 200, skill: {name: 'alt taiki', type: SkillType.TargetSpeed, baseDuration: 5, modifier: 0.35}});
//s.pendingSkills.push({activationPoint: course.distance - 200, skill: {name: 'alt taiki (22)', type: SkillType.CurrentSpeed, baseDuration: 0, modifier: 0.15}});
//s.pendingSkills.push({activationPoint: 1785, skill: {name: 'monopolizer', type: SkillType.TargetSpeed, baseDuration: 3, modifier: -0.25}});
//s.pendingSkills.push({activationPoint: 1785, skill: {name: 'monopolizer (current speed)', type: SkillType.CurrentSpeed, baseDuration: 0, modifier: -0.25}});
const plotData = {t: [0], pos: [0], v: [0], targetv: [s.targetSpeed], a: [0]};
while (s.pos < course.distance) {
	s.step(1/60);
	plotData.t.push(s.accumulatetime);
	plotData.pos.push(s.pos);
	plotData.v.push(s.currentSpeed);
	plotData.targetv.push(s.targetSpeed);
	plotData.a.push(s.accel);
}
//console.log('travelled ' + s.pos + 'm in ' + s.accumulatetime);
//console.log(s.targetSpeed);
//console.log(JSON.stringify(plotData));

const s2 = new RaceIntegrator(uma, course);
s2.pendingSkills.push(nsg);
//s2.pendingSkills.push({activationPoint: pos_dia, skill: {name: 'dia', type: SkillType.TargetSpeed, baseDuration: 5, modifier: 0.45}});
//s2.pendingSkills.push({activationPoint: pos, skill: {name: 'monopolizer', type: SkillType.TargetSpeed, baseDuration: 3, modifier: -0.25}});
//s2.pendingSkills.push({activationPoint: pos, skill: {name: 'monopolizer (current speed)', type: SkillType.CurrentSpeed, baseDuration: 0, modifier: -0.25}});
//s2.pendingSkills.push({activationPoint: course.distance - 200, skill: {name: 'alt taiki', type: SkillType.TargetSpeed, baseDuration: 5, modifier: 0.35}});
while (s2.accumulatetime < s.accumulatetime) {
	s2.step(1/60);
}
//console.log('travelled ' + s2.pos + 'm in ' + s2.accumulatetime);
//console.log('basin gain: ' + (s.pos - s2.pos) / 2.5);
gain.push((s.pos - s2.pos) / 2.5);

}

gain.sort((a,b) => a - b);
console.log('min: ' + gain[0]);
console.log('max: ' + gain[gain.length-1]);
const mid = Math.floor(gain.length / 2);
console.log('median: ' + (gain.length % 2 == 0 ? (gain[mid-1] + gain[mid]) / 2 : gain[mid]));
console.log('mean: ' + gain.reduce((a,b) => a + b) / gain.length);

console.log(gain.reduce((a,b) => a + +(b > 0.5), 0) / gain.length);
