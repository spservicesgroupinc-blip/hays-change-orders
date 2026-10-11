import type { ChangeRequest } from "../types";
import "./RequestQuestions.css";

type Answers = Pick<
  ChangeRequest,
  "requestType" | "customerCredits" | "lineNumbers" | "knownChangeAmount"
>;

export default function RequestQuestions({
  requestType,
  customerCredits,
  lineNumbers = "",
  knownChangeAmount = "",
  disabled = false,
  onChange,
}: Answers & {
  disabled?: boolean;
  onChange: (answers: Answers) => void;
}) {
  const answers = {
    requestType,
    customerCredits,
    lineNumbers,
    knownChangeAmount,
  };
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
                  ...answers,
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
              onChange({ ...answers, customerCredits: event.target.checked })
            }
          />
          <span>Yes, customer credits</span>
        </label>
        <small>
          Leave unchecked if this does not include customer credits.
        </small>
      </div>
      <label className="field">
        <span>Estimate line numbers (optional)</span>
        <textarea
          aria-label="Estimate line numbers"
          rows={2}
          value={lineNumbers}
          placeholder={"+12, -34\n+56"}
          onChange={(event) =>
            onChange({ ...answers, lineNumbers: event.target.value })
          }
        />
        <small>
          Use + for lines to add and - for lines to remove. Separate each line
          number with a comma or a new line.
        </small>
      </label>
      <label className="field">
        <span>Known change amount (optional)</span>
        <input
          aria-label="Known change amount"
          type="text"
          value={knownChangeAmount}
          placeholder="+1250.19 or -250.00"
          onChange={(event) =>
            onChange({ ...answers, knownChangeAmount: event.target.value })
          }
        />
        <small>
          Use + for an increase or - for a credit. Leave blank if the amount is
          unknown.
        </small>
      </label>
    </fieldset>
  );
}
