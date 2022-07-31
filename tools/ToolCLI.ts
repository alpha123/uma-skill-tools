import * as fs from 'fs';
import { Command, Option, InvalidArgumentError } from 'commander';

import { HorseParameters, Strategy, Aptitude } from '../HorseTypes';
import { CourseData, CourseHelpers } from '../CourseData';
import { Conditions, Region, RegionList, ActivationSamplePolicy } from '../ActivationConditions';
import { parse, tokenize } from '../ConditionParser';
import { DynamicCondition, SkillType, SkillEffect } from '../RaceSolver';

import skills from '../data/skill_data.json';

export function parseStrategy(s: string) {
	switch (s.toUpperCase()) {
	case 'NIGE': return Strategy.Nige;
	case 'SENKOU': return Strategy.Senkou;
	case 'SASI':
	case 'SASHI': return Strategy.Sasi;
	case 'OIKOMI': return Strategy.Oikomi;
	case 'OONIGE': return Strategy.Oonige;
	default: throw new InvalidArgumentError('Invalid running strategy.');
	}
}

export function parseAptitude(a: string, type: string) {
	switch (a.toUpperCase()) {
	case 'S': return Aptitude.S;
	case 'A': return Aptitude.A;
	case 'B': return Aptitude.B;
	case 'C': return Aptitude.C;
	case 'D': return Aptitude.D;
	case 'E': return Aptitude.E;
	case 'F': return Aptitude.F;
	case 'G': return Aptitude.G;
	default: throw new InvalidArgumentError('Invalid ' + type + ' aptitude.');
	}
}

const StrategyProficiencyModifier = Object.freeze([1.1, 1.0, 0.85, 0.75, 0.6, 0.4, 0.2, 0.1]);

const GroundSpeedModifier = Object.freeze([
	null, // ground types started at 1
	{good: 0, yielding: 0, soft: 0, heavy: -50},
	{good: 0, yielding: 0, soft: 0, heavy: -50}
].map(o => Object.freeze(o)));

const GroundPowerModifier = Object.freeze([
	null,
	{good: 0, yielding: -50, soft: -50, heavy: -50},
	{good: -100, yielding: -50, soft: -100, heavy: -100}
].map(o => Object.freeze(o)));

export interface SkillData {
	samplePolicy: ActivationSamplePolicy,
	regions: RegionList,
	extraCondition: DynamicCondition,
	effects: SkillEffect[]
}

function buildSkillData(horse: HorseParameters, course: CourseData, wholeCourse: RegionList, skillId: string) {
	if (!(skillId in skills)) {
		throw new InvalidArgumentError('bad skill ID ' + skillId);
	}
	const alternatives = skills[skillId];
	for (var i = 0; i < alternatives.length; ++i) {
		const skill = alternatives[i];
		if (skill.precondition) {
			const pre = parse(tokenize(skill.precondition));
			if (pre.apply(wholeCourse, course, horse)[0].length == 0) {
				continue;
			}
		}
		const op = parse(tokenize(skill.condition));
		const [regions, extraCondition] = op.apply(wholeCourse, course, horse);
		if (regions.length == 0) {
			continue;
		}
		// im on a really old version of node and cant use flatMap
		const effects = skill.effects.reduce((acc,ef) => {
			var type: SkillType | -1 = -1;
			switch (ef.type) {
			case 21:  // debuffs
				acc.push({skillId: skillId, type: SkillType.CurrentSpeed, baseDuration: skill.baseDuration / 10000, modifier: ef.modifier / 10000});
				acc.push({skillId: skillId, type: SkillType.TargetSpeed, baseDuration: skill.baseDuration / 10000, modifier: ef.modifier / 10000});
				return acc;
			case 22: type = SkillType.CurrentSpeed; break;
			case 27: type = SkillType.TargetSpeed; break;
			case 31: type = SkillType.Accel; break;
			}
			if (type != -1) {
				acc.push({skillId: skillId, type: type, baseDuration: skill.baseDuration / 10000, modifier: ef.modifier / 10000});
			}
			return acc;
		}, []);
		if (effects.length > 0) {
			return {
				samplePolicy: op.samplePolicy,
				regions: regions,
				extraCondition: extraCondition,
				effects: effects
			};
		} else {
			return null;
		}
	}
	return null;
}

type CliAction = (horse: HorseParameters, course: CourseData, defSkills: SkillData[], cliSkills: SkillData[], cliOptions: any) => void;

export class ToolCLI {
	program: Command
	action: CliAction

	constructor() {
		this.program = new Command();
		this.program
			.argument('<horsefile>', 'path to a JSON file describing the horse\'s parameters')
			.requiredOption('-c, --course <id>', 'course ID')
			.addOption(new Option('-m, --mood <mood>', 'the uma\'s mood')
				.choices(['-2', '-1', '0', '+1', '+2'])
				.default(+2)
				.argParser(x => parseInt(x,10))  // can't just use .argParser(parseInt) because it also gets passed the default value
			)
			.addOption(new Option('-g, --ground <condition>', 'track condition').choices(['good', 'yielding', 'soft', 'heavy']).default('good'))
			.option('-s, --skill <id>', 'skill to test', (value,list) => list.concat([parseInt(value,10)]), [])
			.option('--skills <ids>', 'comma-separated list of skill IDs', (value,_) => value.split(',').map(id => parseInt(id,10)), [])
			.action((horsefile, options) => {
				this.handleRun(horsefile, options);
			});
	}

	options(fn: (Command) => void) {
		fn(this.program);
	}

	run(fn: CliAction) {
		this.action = fn;
		this.program.parse();
	}

	handleRun(horsefile: string, opts: any) {
		const course = CourseHelpers.getCourse(opts.course);
		const horseDesc = JSON.parse(fs.readFileSync(horsefile, 'utf8'));

		const motivCoef = 1 + 0.02 * opts.mood;

		const baseStats = {
			speed: horseDesc.speed * motivCoef,
			stamina: horseDesc.stamina * motivCoef,
			power: horseDesc.power * motivCoef,
			guts: horseDesc.guts * motivCoef,
			int: horseDesc.int * motivCoef
		};

		const raceCourseModifier = CourseHelpers.courseSpeedModifier(course, baseStats);

		const horse: HorseParameters = Object.freeze({
			speed: baseStats.speed * raceCourseModifier + GroundSpeedModifier[course.surface][opts.ground],
			stamina: baseStats.stamina,
			power: baseStats.power + GroundPowerModifier[course.surface][opts.ground],
			guts: baseStats.guts,
			int: baseStats.int * StrategyProficiencyModifier[parseAptitude(horseDesc.strategyAptitude, 'strategy')],
			strategy: parseStrategy(horseDesc.strategy),
			distanceAptitude: parseAptitude(horseDesc.distanceAptitude, 'distance'),
			surfaceAptitude: parseAptitude(horseDesc.surfaceAptitude, 'surface'),
			strategyAptitude: parseAptitude(horseDesc.strategyAptitude, 'strategy')
		});

		const wholeCourse = new RegionList();
		wholeCourse.push(new Region(0, course.distance));
		Object.freeze(wholeCourse);

		const makeSkill = buildSkillData.bind(null, horse, course, wholeCourse);
		const defSkills = horseDesc.skills.map(makeSkill).filter(s => s != null);
		const cliSkills = opts.skills.concat(opts.skill).map(makeSkill).filter(s => s != null);

		this.action(horse, course, defSkills, cliSkills, opts);
	}
}
