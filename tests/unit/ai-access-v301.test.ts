import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canUseAssistant, parseAllowedEmails } from '@/domain/ai';
import { aiConfig } from '@/server/ai/config';

/**
 * v301 - the assistant runs for named accounts while the team waits.
 *
 * The owner's words were "for now I don't want my team to use this - let my
 * account only use it". v299 had settled the audience as manager and
 * administrator, which is the right long-term rule and the wrong one for a
 * first week: `administrator` is a job, and anybody else holding it would be
 * admitted by a rule meant to admit one person.
 *
 * So a named list sits above the role rule. These tests pin the two
 * properties that make it worth having rather than merely present:
 *
 *   * when the list is set, the role is not consulted AT ALL - which is what
 *     stops a second administrator getting in, and equally what stops the
 *     owner being locked out of their own assistant for being a manager;
 *   * when it is empty, nothing about v299 changes.
 *
 * The second matters more than it looks. An empty value is what every
 * environment has by default, CI included, so a mistake there would not
 * refuse people - it would quietly restore the v298 defect of a feature with
 * no gate, or quietly refuse everybody. Both are tested below.
 */

const OWNER = 'owner@tamco.com.my';
const COLLEAGUE = 'someone.else@tamco.com.my';

describe('v301 a named list', () => {
  it('admits the named account and refuses everyone else, whatever their role', () => {
    const list = [OWNER];
    expect(canUseAssistant('administrator', OWNER, list)).toBe(true);
    /*
     * The case this exists for. Both of these would pass the v299 role rule,
     * and both are the "team" the owner asked to keep out.
     */
    expect(canUseAssistant('administrator', COLLEAGUE, list)).toBe(false);
    expect(canUseAssistant('manager', COLLEAGUE, list)).toBe(false);
  });

  it('admits a named person who is not a manager at all', () => {
    /*
     * Deliberate, and the reason the list replaces the role rule rather than
     * narrowing it. Had it been an AND, an owner whose own account is a plain
     * team member would have been locked out of the assistant they had just
     * named themselves on, and the symptom - a 404 on a page they can see in
     * no menu - gives nothing away about the cause.
     */
    expect(canUseAssistant('team_member', OWNER, [OWNER])).toBe(true);
  });

  it('is not fooled by case or stray spaces', () => {
    const list = parseAllowedEmails(`  ${OWNER.toUpperCase()} , `);
    expect(list).toEqual([OWNER]);
    expect(canUseAssistant('manager', ` ${OWNER} `, list)).toBe(true);
  });

  it('refuses an account with no email address rather than admitting it', () => {
    expect(canUseAssistant('administrator', null, [OWNER])).toBe(false);
    expect(canUseAssistant('administrator', undefined, [OWNER])).toBe(false);
    expect(canUseAssistant('administrator', '', [OWNER])).toBe(false);
  });

  /*
   * A partial match must not pass. Without this, a list naming
   * `owner@tamco.com.my` would be satisfied by an address that merely
   * contains it, and anybody able to set their own address could walk in.
   */
  it('matches the whole address, not part of one', () => {
    expect(canUseAssistant('manager', `x${OWNER}`, [OWNER])).toBe(false);
    expect(canUseAssistant('manager', `${OWNER}.attacker.example`, [OWNER])).toBe(false);
  });

  it('falls back to the v299 role rule when nobody is named', () => {
    for (const empty of [[], parseAllowedEmails(''), parseAllowedEmails(undefined)]) {
      expect(canUseAssistant('manager', COLLEAGUE, empty)).toBe(true);
      expect(canUseAssistant('administrator', COLLEAGUE, empty)).toBe(true);
      /*
       * The one that would have reopened v299. An empty list must not mean
       * "no rule".
       */
      expect(canUseAssistant('team_member', COLLEAGUE, empty)).toBe(false);
    }
  });

  it('keeps the v299 behaviour for callers that pass no list at all', () => {
    expect(canUseAssistant('manager')).toBe(true);
    expect(canUseAssistant('team_member')).toBe(false);
  });
});

describe('v301 parsing the configured value', () => {
  it('reads a comma-separated list', () => {
    expect(parseAllowedEmails(`${OWNER},${COLLEAGUE}`)).toEqual([OWNER, COLLEAGUE]);
  });

  /*
   * Empty entries are dropped rather than kept as ''. A trailing comma is the
   * single likeliest typing mistake in a hosting dashboard, and an entry of
   * '' in the list would make the list non-empty - switching the whole
   * installation to named-accounts-only and refusing every manager, with no
   * visible cause.
   */
  it('drops empty entries so a trailing comma cannot change the rule', () => {
    const list = parseAllowedEmails(`${OWNER},,  ,`);
    expect(list).toEqual([OWNER]);
    expect(canUseAssistant('manager', COLLEAGUE, list)).toBe(false);
  });

  it('treats blank and unset as nobody named', () => {
    expect(parseAllowedEmails('   ')).toEqual([]);
    expect(parseAllowedEmails(null)).toEqual([]);
    expect(parseAllowedEmails(undefined)).toEqual([]);
  });
});

const TOUCHED = ['AI_ALLOWED_EMAILS', 'AI_PROVIDER'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of TOUCHED) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of TOUCHED) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('v301 the configuration carries the list', () => {
  it('is empty when the variable is unset', () => {
    expect(aiConfig().allowedEmails).toEqual([]);
  });

  it('reads and normalises what an owner typed', () => {
    process.env.AI_ALLOWED_EMAILS = ` ${OWNER.toUpperCase()}, ${COLLEAGUE} `;
    expect(aiConfig().allowedEmails).toEqual([OWNER, COLLEAGUE]);
  });

  /*
   * End to end through the thing the page and the route actually call: the
   * configuration is read, and the answer it produces is the one above.
   */
  it('refuses an unnamed administrator through the configured list', () => {
    process.env.AI_ALLOWED_EMAILS = OWNER;
    const { allowedEmails } = aiConfig();
    expect(canUseAssistant('administrator', COLLEAGUE, allowedEmails)).toBe(false);
    expect(canUseAssistant('administrator', OWNER, allowedEmails)).toBe(true);
  });
});
