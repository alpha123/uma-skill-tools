import * as fs from 'fs';
import { program, Command, Option, InvalidArgumentError } from 'commander';

import { HorseParameters, Strategy, Aptitude } from '../HorseTypes';
import { CourseData, CourseHelpers } from '../CourseData';
import { Conditions, Region, RegionList } from '../ActivationConditions';
import { parse, tokenize } from '../ConditionParser';
import { SkillType, RaceSolver } from '../RaceSolver';

import skills from '../data/skill_data.json';

program
    .argument('<horsefile>', 'path to a JSON file describing the horse\'s parameters')
    .requiredOption('-c, --course <id>', 'course ID')
    .addOption(new Option('-m, --mood', 'the uma\'s mood').choices(['-2', '-1', '0', '+1', '+2']).default('0').argParser(parseInt))
    .addOption(new Option('-g, --ground', 'track condition').choices(['good', 'yielding', 'soft', 'heavy']).default('good'))
    .option('-s, --skill <id>', 'skill to test', (value,list) => list.concat([parseInt(value,10)]), [])
    .option('--skills <ids>', 'comma-separated list of skill IDs', (value,_) => value.split(',').map(id => parseInt(id,10)), [])
    .action((horsefile, options) => {
        options.horsefile = horsefile;
    });

program.parse();
const opts = program.opts();

const course = CourseHelpers.getCourse(opts.course);

const horseDesc = JSON.parse(fs.readFileSync(opts.horsefile, 'utf8'));

function strategy(s: string) {
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

function aptitude(a: string, type: string) {
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

const motivCoef = 1 + 0.02 * opts.mood;

const baseStats = {
    speed: horseDesc.speed * motivCoef,
    stamina: horseDesc.stamina * motivCoef,
    power: horseDesc.power * motivCoef,
    guts: horseDesc.guts * motivCoef,
    int: horseDesc.int * motivCoef
};

const raceCourseModifier = CourseHelpers.courseSpeedModifier(course, baseStats);

const uma: HorseParameters = Object.freeze({
    speed: baseStats.speed * raceCourseModifier + GroundSpeedModifier[course.surface][opts.ground],
    stamina: baseStats.stamina,
    power: baseStats.power + GroundPowerModifier[course.surface][opts.ground],
    guts: baseStats.guts,
    int: baseStats.int * StrategyProficiencyModifier[aptitude(horseDesc.strategyAptitude, 'strategy')],
    strategy: strategy(horseDesc.strategy),
    distanceAptitude: aptitude(horseDesc.distanceAptitude, 'distance'),
    surfaceAptitude: aptitude(horseDesc.surfaceAptitude, 'surface'),
    strategyAptitude: aptitude(horseDesc.strategyAptitude, 'strategy')
});

const wholeCourse = new RegionList();
wholeCourse.push(new Region(0, course.distance));
Object.freeze(wholeCourse);

const s = new RaceSolver(uma, course);

horseDesc.skills.concat(opts.skills).concat(opts.skill).forEach(skillId => {
    if (!(skillId in skills)) {
        throw new InvalidArgumentError('bad skill ID ' + skillId);
    }
    const alternatives = skills[skillId];
    for (var i = 0; i < alternatives.length; ++i) {
        const skill = alternatives[i];
        if (skill.precondition) {
            const pre = parse(tokenize(skill.precondition));
            if (pre.samplePolicy.sample(pre.apply(wholeCourse, course, uma), 1).length == 0) {
                continue;
            }
        }
        const op = parse(tokenize(skill.condition));
        const triggers = op.samplePolicy.sample(op.apply(wholeCourse, course, uma), 1);
        if (triggers.length == 0) {
            continue;
        }
        skill.effects.forEach(ef => {
            var type: SkillType | -1 = -1;
            switch (ef.type) {
            case 22: type = SkillType.CurrentSpeed; break;
            case 27: type = SkillType.TargetSpeed; break;
            case 31: type = SkillType.Accel; break;
            }
            if (type != -1) {
                s.pendingSkills.push({
                    trigger: triggers[0],
                    skill: {name: skillId, type: type, baseDuration: skill.baseDuration / 10000, modifier: ef.modifier / 10000}
                });
            }
        });
    }
});

const plotData = {trackId: course.raceTrackId, courseId: opts.course, t: [0], pos: [0], v: [0], targetv: [s.targetSpeed], a: [0], skills: {}};

s.onSkillActivate = (sk) => { plotData.skills[sk.name] = [sk.type,s.accumulatetime,0,s.pos,0]; }
s.onSkillDeactivate = (sk) => {
    plotData.skills[sk.name][2] = s.accumulatetime;
    plotData.skills[sk.name][4] = s.pos;
}

while (s.pos < course.distance) {
	s.step(1/60);
	plotData.t.push(s.accumulatetime);
	plotData.pos.push(s.pos);
	plotData.v.push(s.currentSpeed);
	plotData.targetv.push(s.targetSpeed);
	plotData.a.push(s.accel);
}

// clean up skills that haven't deactivated by the end of the race
Object.keys(plotData.skills).forEach(sk => {
    if (plotData.skills[sk][2] == 0) {
        plotData.skills[sk][2] = s.accumulatetime;
        plotData.skills[sk][4] = s.pos;
    }
});

console.log(JSON.stringify(plotData));
