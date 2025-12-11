import * as fc from 'fast-check';
import { Condition, distributionRandomFactory } from '../ActivationConditions';
import { ErlangRandomPolicy, LogNormalRandomPolicy, UniformRandomPolicy } from '../ActivationSamplePolicy';
import { forAll, prop } from './TestHelpers';

const policyClassesArb = fc.oneof(
  fc.record({
    cls: fc.constant(LogNormalRandomPolicy),
    args: fc.tuple(fc.integer(), fc.integer())
  }),
  fc.record({
    cls: fc.constant(ErlangRandomPolicy),
    args: fc.tuple(fc.integer(), fc.integer())
  }),
  fc.record({
    cls: fc.constant(UniformRandomPolicy),
    args: fc.tuple() // Empty tuple for no-arg constructor.
  })
);

const conditionArb = fc.option(
  fc.record({
    filterEq: fc.func(fc.anything()),
    filterNeq: fc.func(fc.anything()),
    filterLt: fc.func(fc.anything()),
    filterLte: fc.func(fc.anything()),
    filterGt: fc.func(fc.anything()),
    filterGte: fc.func(fc.anything()),
  }),
  { nil: undefined }
);

prop('ensure same args produce same samplePolicy instance', forAll(policyClassesArb, arb => {
    const conditionFactory: (...args: [...ConstructorParameters<typeof arb.cls>, Partial<Condition>]) => Condition = distributionRandomFactory(arb.cls);
    const c1: Condition = conditionFactory(...arb.args, {});
    const c2: Condition = conditionFactory(...arb.args, {});
    return Object.is(c1.samplePolicy, c2.samplePolicy);
}));

prop('ensure different args produce same samplePolicy instance', forAll(fc.tuple(policyClassesArb, policyClassesArb), ([arb1, arb2]) => {
    fc.pre(arb1.cls === arb2.cls);
    const conditionFactory: (...args: [...ConstructorParameters<typeof arb1.cls>, Partial<Condition>]) => Condition = distributionRandomFactory(arb1.cls);
    const c1: Condition = conditionFactory(...arb1.args, {});
    const c2: Condition = conditionFactory(...arb2.args, {});
    
    if (JSON.stringify(arb1.args) !== JSON.stringify(arb2.args)) {
      return !Object.is(c1.samplePolicy, c2.samplePolicy);
    }

    return true; 
}));


prop('ensure partial condition is merged', forAll(fc.tuple(policyClassesArb, conditionArb), ([pArb, cArb]) => {
    const conditionFactory: (...args: [...ConstructorParameters<typeof pArb.cls>, Partial<Condition>]) => Condition = distributionRandomFactory(pArb.cls);
    const result = conditionFactory(...pArb.args, cArb);

    if (!(result.samplePolicy instanceof pArb.cls)) return false;

    // Test that all filters are notSupported if cArb is undefined.
    // We can remove the overhead of try/catch behavior checking by exporting the notSupported function.
    if(cArb === undefined) {
        return Object.keys(result).filter(k => k !== 'samplePolicy').every(k => {
            try {
                result[k]([], 0, {}, {}, {});
                return false;
            } catch {
                return true;
            }
        });
    }

    return Object.keys(cArb).every(k => k in result);
}));



