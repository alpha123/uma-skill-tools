import { HorseParameters } from '../HorseTypes';
import { CourseData } from '../CourseData';
import { RaceSolver } from '../RaceSolver';
import { SkillData, ToolCLI } from './ToolCLI';

const cli = new ToolCLI();
cli.run((horse: HorseParameters, course: CourseData, defSkills: SkillData[], cliSkills: SkillData[], cliOptions: any) => {
    const s = new RaceSolver(horse, course);

    function addSkill(sd) {
        const trigger = sd.samplePolicy.sample(sd.regions, 1)[0];
        s.pendingSkills.push.apply(s.pendingSkills,
            sd.effects.map(ef => ({trigger: trigger, extraCondition: sd.extraCondition, effect: ef})));
    }

    defSkills.forEach(addSkill);
    cliSkills.forEach(addSkill);

    const plotData = {trackId: course.raceTrackId, courseId: cliOptions.course, t: [0], pos: [0], v: [0], targetv: [s.targetSpeed], a: [0], skills: {}};

    s.onSkillActivate = (sk) => { plotData.skills[sk.skillId] = [sk.type,s.accumulatetime,0,s.pos,0]; }
    s.onSkillDeactivate = (sk) => {
        plotData.skills[sk.skillId][2] = s.accumulatetime;
        plotData.skills[sk.skillId][4] = s.pos;
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
});
