// The list of people, kept encrypted inside the archive.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Person, PersonDetails } from '../shared/people.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const PEOPLE_FILENAME = 'people.sealed';
const PURPOSE = 'echo/people/v1';

function file(archiveDir: string): string {
  return path.join(archiveDir, PEOPLE_FILENAME);
}

export function loadPeople(archiveDir: string, masterKey: Buffer): Person[] {
  return readSealedFile<{ people: Person[] }>(file(archiveDir), masterKey, PURPOSE)?.people ?? [];
}

function savePeople(archiveDir: string, masterKey: Buffer, people: Person[]): void {
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, { people });
}

function tidy(details: PersonDetails): PersonDetails {
  return {
    name: details.name.trim(),
    relationship: details.relationship.trim(),
    callsMe: details.callsMe.trim(),
    mayTalkToEcho: details.mayTalkToEcho === true,
  };
}

export function addPerson(archiveDir: string, masterKey: Buffer, details: PersonDetails): Person {
  const person: Person = { id: randomUUID(), ...tidy(details), addedAt: new Date().toISOString() };
  savePeople(archiveDir, masterKey, [...loadPeople(archiveDir, masterKey), person]);
  return person;
}

/** Returns false if there is no such person. */
export function changePerson(archiveDir: string, masterKey: Buffer, id: string, details: PersonDetails): boolean {
  const people = loadPeople(archiveDir, masterKey);
  if (!people.some((person) => person.id === id)) return false;
  savePeople(archiveDir, masterKey, people.map((person) => (person.id === id ? { ...person, ...tidy(details) } : person)));
  return true;
}

/** Returns false if there is no such person. */
export function removePerson(archiveDir: string, masterKey: Buffer, id: string): boolean {
  const people = loadPeople(archiveDir, masterKey);
  if (!people.some((person) => person.id === id)) return false;
  savePeople(archiveDir, masterKey, people.filter((person) => person.id !== id));
  return true;
}
