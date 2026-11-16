/** Shows plain-English reasons something was refused. Draws nothing when there are none. */
export function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="problems" role="alert" data-problems>
      {problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  );
}
