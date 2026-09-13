import { directTeamFirst } from '@/domain/people-order';

/**
 * The options of a select that hands work to a person (v175): the direct team
 * under its own heading, then everyone else.
 *
 * Headings only when there is a team to head. Somebody with nobody reporting to
 * them gets the plain alphabetical list, rather than an empty "Your team" group
 * above everybody.
 */
export function PeopleOptions({
  people,
}: {
  people: Array<{ id: string; name: string; directReport: boolean }>;
}) {
  const { team, everyoneElse } = directTeamFirst(people);
  const option = (person: { id: string; name: string }) => (
    <option key={person.id} value={person.id}>
      {person.name}
    </option>
  );

  if (team.length === 0) return <>{everyoneElse.map(option)}</>;
  return (
    <>
      <optgroup label="Your team">{team.map(option)}</optgroup>
      {everyoneElse.length > 0 && (
        <optgroup label="Everyone else">{everyoneElse.map(option)}</optgroup>
      )}
    </>
  );
}
