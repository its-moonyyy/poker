import { describe, it, expect } from 'vitest';
import { buildSidePots } from '../src/pots.js';

describe('buildSidePots', () => {
  it('3-way all-in layers correctly and conserves', () => {
    const pots = buildSidePots([{seat:0,amount:10000},{seat:1,amount:6000},{seat:2,amount:4000}]);
    expect(pots.map(p=>p.amount)).toEqual([12000,4000,4000]);
    expect(pots[0].eligible.sort()).toEqual([0,1,2]);
    expect(pots[1].eligible.sort()).toEqual([0,1]);
    expect(pots[2].eligible).toEqual([0]);
  });
  it('equal stacks single pot', () => {
    const pots = buildSidePots([{seat:0,amount:1000},{seat:1,amount:1000},{seat:2,amount:1000}]);
    expect(pots).toHaveLength(1); expect(pots[0].amount).toBe(3000);
  });
  it('one short stack creates side pot', () => {
    const pots = buildSidePots([{seat:0,amount:500},{seat:1,amount:1000},{seat:2,amount:1000}]);
    expect(pots.map(p=>p.amount)).toEqual([1500,1000]);
  });
  it('ignores zero contributions', () => {
    const pots = buildSidePots([{seat:0,amount:0},{seat:1,amount:600},{seat:2,amount:600}]);
    expect(pots).toHaveLength(1); expect(pots[0].amount).toBe(1200);
  });
  it('heads-up uneven', () => {
    const pots = buildSidePots([{seat:0,amount:200},{seat:1,amount:1000}]);
    expect(pots.map(p=>p.amount)).toEqual([400,800]);
  });
  it('four levels', () => {
    const pots = buildSidePots([
      {seat:0,amount:100},{seat:1,amount:200},{seat:2,amount:300},{seat:3,amount:400},
    ]);
    expect(pots.map(p=>p.amount)).toEqual([400,300,200,100]);
    expect(pots.reduce((s,p)=>s+p.amount,0)).toBe(1000);
  });
  it('tied contributors share eligibility', () => {
    const pots = buildSidePots([{seat:0,amount:1000},{seat:1,amount:1000},{seat:2,amount:2000}]);
    expect(pots.map(p=>p.amount)).toEqual([3000,1000]);
    expect(pots[1].eligible).toEqual([2]);
  });
  it('total conserved on complex shape', () => {
    const contribs = [
      {seat:0,amount:10000},{seat:1,amount:10000},{seat:2,amount:6000},
      {seat:3,amount:6000},{seat:4,amount:2500},
    ];
    const pots = buildSidePots(contribs);
    const totalIn = contribs.reduce((s,c)=>s+c.amount,0);
    expect(pots.reduce((s,p)=>s+p.amount,0)).toBe(totalIn);
  });
});
