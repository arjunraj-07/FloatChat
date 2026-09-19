/**
 * Account helpers: the pure parts, testable without a browser or a server.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCOUNT_ROLES,
  PASSWORD_MIN_CHARS,
  defaultViewForRole,
  registrationProblem,
  roleLabel,
  signInProblem,
} from '../src/lib/auth.ts';
import { csrfHeader, currentCsrfToken, setCsrfToken } from '../src/lib/csrf.ts';

describe('account roles', () => {
  it('offers exactly the two self-selected roles', () => {
    assert.deepEqual([...ACCOUNT_ROLES], ['student', 'scientist']);
  });

  it('opens each role in its own default presentation', () => {
    assert.equal(defaultViewForRole('student'), 'student');
    assert.equal(defaultViewForRole('scientist'), 'scientific');
  });

  it('names the roles for display', () => {
    assert.equal(roleLabel('student'), 'Student');
    assert.equal(roleLabel('scientist'), 'Scientist');
  });

  it('treats the default view as a starting point, not a permission', () => {
    // The helper maps a role to a presentation and nothing else: there is no
    // capability, endpoint or data difference expressed here.
    const views = ACCOUNT_ROLES.map(defaultViewForRole);
    assert.deepEqual(views, ['student', 'scientific']);
  });
});

describe('registration bounds', () => {
  it('accepts a well-formed registration', () => {
    assert.equal(registrationProblem('marine@example.org', 'correct-horse-battery'), null);
  });

  it('requires an email that could be one', () => {
    assert.match(registrationProblem('', 'correct-horse-battery') ?? '', /email/i);
    assert.match(registrationProblem('nope', 'correct-horse-battery') ?? '', /valid email/i);
    assert.match(registrationProblem('a@b', 'correct-horse-battery') ?? '', /valid email/i);
  });

  it('requires a password of the server minimum length', () => {
    const short = 'x'.repeat(PASSWORD_MIN_CHARS - 1);
    assert.match(registrationProblem('marine@example.org', short) ?? '', /at least/i);
    assert.equal(
      registrationProblem('marine@example.org', 'x'.repeat(PASSWORD_MIN_CHARS)),
      null,
    );
  });

  it('bounds an over-long password rather than sending it', () => {
    const long = 'x'.repeat(500);
    assert.match(registrationProblem('marine@example.org', long) ?? '', /limited to/i);
  });

  it('trims surrounding space before judging the address', () => {
    assert.equal(registrationProblem('  marine@example.org  ', 'correct-horse-battery'), null);
  });
});

describe('sign-in bounds', () => {
  it('asks for both fields before sending a request', () => {
    assert.match(signInProblem('', 'pw') ?? '', /email/i);
    assert.match(signInProblem('marine@example.org', '') ?? '', /password/i);
    assert.equal(signInProblem('marine@example.org', 'pw'), null);
  });

  it('does not impose registration rules on sign-in', () => {
    // An existing account may predate any rule change; the server decides.
    assert.equal(signInProblem('marine@example.org', 'short'), null);
  });
});

describe('csrf token store', () => {
  it('starts empty and contributes no header', () => {
    setCsrfToken(null);
    assert.equal(currentCsrfToken(), null);
    assert.deepEqual(csrfHeader(), {});
  });

  it('supplies the header once a session exists', () => {
    setCsrfToken('token-value');
    assert.equal(currentCsrfToken(), 'token-value');
    assert.deepEqual(csrfHeader(), { 'X-CSRF-Token': 'token-value' });
    setCsrfToken(null);
  });

  it('clears on sign-out', () => {
    setCsrfToken('token-value');
    setCsrfToken(null);
    assert.deepEqual(csrfHeader(), {});
  });
});
