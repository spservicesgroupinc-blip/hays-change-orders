import type { ChangeRequest } from "../types";
import "./RequestQuestions.css";

type Answers = Pick<ChangeRequest, "requestType" | "customerCredits">;

export default function RequestQuestions({
  requestType,
  customerCredits,
  disabled = false,
  onChange,
}: Answers & {
  disabled?: boolean;
  onChange: (answers: Answers) => void;
}) {
  return (
    <fieldset className="request-questions" disabled={disabled}>
      <legend>Request details</legend>
      <div
        role="group"
        aria-label="Is this a change order or an insurance supplement?"
      >
        <p>Is this a change order or an insurance supplement?</p>
        {(
          [
            ["change_order", "Change order"],
            ["insurance_supplement", "Insurance supplement"],
          ] as const
        ).map(([value, label]) => (
          <label className="request-checkbox" key={value}>
            <input
              type="checkbox"
              checked={requestType === value}
              onChange={(event) =>
                onChange({
                  requestType: event.target.checked ? value : undefined,
                  customerCredits,
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div role="group" aria-label="Does this include customer credits?">
        <p>Does this include customer credits?</p>
        <label className="request-checkbox">
          <input
            type="checkbox"
            checked={customerCredits === true}
            onChange={(event) =>
              onChange({ requestType, customerCredits: event.target.checked })
            }
          />
          <span>Yes, customer credits</span>
        </label>
        <small>
          Leave unchecked if this does not include customer credits.
        </small>
      </div>
    </fieldset>
  );
}
