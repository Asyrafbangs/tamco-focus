'use client';

import { useState, useTransition } from 'react';

import { addQrLocation, retireQrLocation } from '@/server/esh/qr-location-actions';

export interface QrLocation {
  id: string;
  code: string;
  label: string;
  departmentName: string | null;
  active: boolean;
  url: string;
}

/**
 * The places a sticker can point at (v289, §2).
 *
 * Each row is one printed sticker. The address is shown in full because that
 * is what goes into whatever prints the QR code, and the code itself is shown
 * beside it so a sticker found on a wall can be matched to its row without
 * scanning it.
 *
 * Retired locations stay in the list, greyed, for the same reason the row is
 * kept in the database: a sticker that has been glued to a machine cannot be
 * recalled, and somebody who finds one needs to be able to tell that it is
 * dead on purpose rather than missing.
 */
export function QrLocations({
  locations,
  departments,
  canCoordinate,
}: {
  locations: QrLocation[];
  departments: Array<{ id: string; name: string }>;
  canCoordinate: boolean;
}) {
  const [label, setLabel] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const live = locations.filter((one) => one.active);
  const retired = locations.filter((one) => !one.active);

  function add() {
    setSaid(null);
    start(async () => {
      const result = await addQrLocation({ label, departmentId: departmentId || null });
      if (!result.ok) {
        setSaid({ ok: false, message: result.message });
        return;
      }
      setLabel('');
      setSaid({ ok: true, message: 'Location added. Print its address as a QR code.' });
    });
  }

  /**
   * v290 - "Copied" only after the clipboard has actually taken it.
   *
   * This used to fire and forget, so a browser without clipboard access, or
   * one that refused the permission, still said Copied - and the address a
   * sticker is printed from was not on the clipboard at all. Where the write
   * is not possible, the address is selected instead, which is the thing a
   * person can then copy by hand.
   */
  async function copyAddress(id: string, url: string) {
    setSaid(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      setCopied(id);
      return;
    } catch {
      setCopied(null);
      setSaid({
        ok: false,
        message: 'This browser would not let the page copy. Select the address and copy it.',
      });
    }
  }

  function retire(id: string, name: string) {
    setSaid(null);
    start(async () => {
      const result = await retireQrLocation({ id });
      setSaid(
        result.ok
          ? { ok: true, message: `${name} will no longer accept reports.` }
          : { ok: false, message: result.message },
      );
    });
  }

  return (
    <section className="esh-form-card esh-qr-locations" aria-labelledby="esh-qr-locations-title">
      <h2 id="esh-qr-locations-title" className="esh-form-card-title">
        QR locations
      </h2>
      <p className="form-hint">
        One row per sticker. The address below is what the QR code encodes; the code in it is
        generated, so nothing in the address says where the sticker is.
      </p>

      {live.length === 0 ? (
        <p className="notice warn" role="status">
          No locations yet. Public reporting can be switched on, but every sticker would say the
          link does not report anything until a location exists here.
        </p>
      ) : (
        <ul className="esh-qr-list">
          {live.map((one) => (
            <li key={one.id}>
              <div className="esh-qr-row">
                <span className="esh-qr-label">
                  <strong>{one.label}</strong>
                  <small>{one.departmentName ?? 'No department — organisation-wide queue'}</small>
                </span>
                {canCoordinate && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending}
                    onClick={() => retire(one.id, one.label)}
                  >
                    Retire
                  </button>
                )}
              </div>
              <div className="esh-qr-address">
                <code>{one.url}</code>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void copyAddress(one.id, one.url)}
                >
                  {copied === one.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {retired.length > 0 && (
        <details className="esh-qr-retired">
          <summary>{retired.length} retired</summary>
          <ul>
            {retired.map((one) => (
              <li key={one.id}>
                {one.label} — <code>{one.code}</code>, no longer accepts reports
              </li>
            ))}
          </ul>
        </details>
      )}

      {canCoordinate && (
        <div className="esh-qr-add">
          <div className="esh-field">
            <label htmlFor="esh-qr-label">
              <span>Where the sticker goes</span>
            </label>
            <input
              id="esh-qr-label"
              value={label}
              maxLength={160}
              placeholder="BR2 Press line 2"
              onChange={(event) => {
                setLabel(event.target.value);
                setSaid(null);
              }}
            />
            <p className="form-hint">
              This is what the reporter sees at the top of the form, so write it the way somebody
              standing there would describe the place.
            </p>
          </div>
          <div className="esh-field">
            <label htmlFor="esh-qr-department">
              <span>Department (optional)</span>
            </label>
            <select
              id="esh-qr-department"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">No department — organisation-wide queue</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn primary small"
            disabled={pending || label.trim() === ''}
            onClick={add}
          >
            {pending ? 'Adding…' : 'Add location'}
          </button>
        </div>
      )}

      {said && (
        <p
          className={said.ok ? 'notice success' : 'notice error'}
          role={said.ok ? 'status' : 'alert'}
        >
          {said.message}
        </p>
      )}
    </section>
  );
}
