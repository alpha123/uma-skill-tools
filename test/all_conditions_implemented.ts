import test from 'tape';

import { RaceSolverBuilder } from '../RaceSolverBuilder';

import skills from '../data/skill_data.json';

test('all conditions should be implemented and not throw', t => {
	const ids = Object.keys(skills);
	t.plan(ids.length);
	// only checking if constructing the trigger throws, so horse/course do not actually matter
	const uma = Object.freeze({
		speed: 1200,
		stamina: 1200,
		power: 1200,
		guts: 1200,
		wisdom: 1200,
		strategy: 'Oikomi',
		distanceAptitude: 'S',
		surfaceAptitude: 'S',
		strategyAptitude: 'S'
	});
	Object.keys(skills).forEach(id => t.doesNotThrow(() => new RaceSolverBuilder(1).course(10606).horse(uma).addSkill(id).build().next(), id));
});