'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { setFindingHazard } from '@/server/esh/hazard-actions';

export interface HazardOption {
  code: string;
  label: string;
  description: string;
}

/**
 * What kind of hazard this is (v287, §4).
 *
 * One primary category, and a second only where ESH genuinely needs one. No
 * severity, no scoring, no sub-categories: the register and the distribution
 * both group by the primary, and a finding that is recorded as three things
 * makes every count ambiguous.
 *
 * "Not categorised" is an option rather than an empty state to be filled in.
 * It is a real answer — a finding under review that nobody has classified yet,
 * and a classification ESH has withdrawn — and the distribution counts it, so
 * hiding it in the UI would only hide the gap.
 */
export function HazardClassification({
  findingId,
  categories,
  primary,
  secondary,
  canCoordinate,
}: {
  findingId: string;
  categories: HazardOption[];
  primary: string | null;
  secondary: string | null;
  canCoordinate: boolean;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState(primary ?? '');
  const [second, setSecond] = useState(secondary ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const labelFor = (code: string | null) =>
    categories.find((category) => category.code === code)?.label ?? null;
  const described = categories.find((category) => category.code === chosen)?.description ?? null;
  const unchanged = chosen === (primary ?? '') && second === (secondary ?? '');

  function save() {
    setProblem(null);
    setSaved(false);
    start(async () => {
      const result = await setFindingHazard({
        findingId,
        primary: chosen || null,
        // A second category without a first is not a classification; clearing
        // the primary clears both rather than being refused.
        secondary: chosen ? second || null : null,
      });
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      if (!chosen) setSecond('');
      setSaved(true);
      router.refresh();
    });
  }

  if (!canCoordinate) {
    const shown = labelFor(primary);
    return (
      <p className="esh-hazard-read">
        {shown ? (
          <>
            {shown}
            {labelFor(secondary) && (
              <span className="esh-hazard-second">{labelFor(secondary)}</span>
            )}
          </>
        ) : (
          <span className="form-hint">Not categorised yet.</span>
        )}
      </p>
    );
  }

  return (
    <div className="esh-hazard">
      <div className="esh-field">
        <label htmlFor="esh-hazard-primary">
          <span>Hazard category</span>
        </label>
        <select
          id="esh-hazard-primary"
          value={chosen}
          disabled={pending}
          onChange={(event) => {
            setChosen(event.target.value);
            setProblem(null);
            setSaved(false);
            if (!event.target.value) setSecond('');
          }}
        >
          <option value="">Not categorised</option>
          {categories.map((category) => (
            <option key={category.code} value={category.code}>
              {category.label}
            </option>
          ))}
        </select>
        {described && <p className="form-hint">{described}</p>}
      </div>

      {chosen && (
        <div className="esh-field">
          <label htmlFor="esh-hazard-secondary">
            <span>Also (optional)</span>
          </label>
          <select
            id="esh-hazard-secondary"
            value={second}
            disabled={pending}
            onChange={(event) => {
              setSecond(event.target.value);
              setProblem(null);
              setSaved(false);
            }}
          >
            <option value="">Nothing else</option>
            {categories
              .filter((category) => category.code !== chosen)
              .map((category) => (
                <option key={category.code} value={category.code}>
                  {category.label}
                </option>
              ))}
          </select>
        </div>
      )}

      <button
        type="button"
        className="btn primary small"
        disabled={pending || unchanged}
        onClick={save}
      >
        {pending ? 'Saving…' : 'Save category'}
      </button>

      {problem && (
        <p className="notice warn" role="status">
          {problem}
        </p>
      )}
      {saved && !problem && (
        <p className="form-hint" role="status">
          Category saved.
        </p>
      )}
    </div>
  );
}
