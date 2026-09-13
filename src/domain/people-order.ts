/**
 * Who a manager is offered first when giving work to somebody (v175).
 *
 * The people who report to them. A manager assigning work is nearly always
 * assigning it to their own team, and in an organisation of six hundred the
 * team is a handful of names scattered through an alphabetical list. So the
 * pickers that hand over ownership show the direct team first, then everyone
 * else — everyone else still there, because work does cross teams.
 *
 * Direct means the reporting line only. A dotted line grants nothing (v173),
 * and that includes a place at the top of this list.
 */

export interface OrderablePerson {
  id: string;
  directReport: boolean;
}

export function directTeamFirst<Person extends OrderablePerson>(
  people: Person[],
): { team: Person[]; everyoneElse: Person[] } {
  return {
    team: people.filter((person) => person.directReport),
    everyoneElse: people.filter((person) => !person.directReport),
  };
}
