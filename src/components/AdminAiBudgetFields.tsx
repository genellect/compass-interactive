export function AdminAiBudgetFields({
  dayCost,
  disabled = false,
  lectureCost,
  onDayCostChange,
  onLectureCostChange,
}: {
  dayCost: string
  disabled?: boolean
  lectureCost: string
  onDayCostChange: (value: string) => void
  onLectureCostChange: (value: string) => void
}) {
  return (
    <div className="admin-ai-policy-costs">
      <label className="field">
        <span>講義ごとの上限（USD）</span>
        <input
          disabled={disabled}
          inputMode="decimal"
          max="5.00"
          min="0.01"
          onChange={(event) => onLectureCostChange(event.target.value)}
          required
          step="0.01"
          type="number"
          value={lectureCost}
        />
      </label>
      <label className="field">
        <span>1日ごとの上限（USD）</span>
        <input
          disabled={disabled}
          inputMode="decimal"
          max="20.00"
          min="0.01"
          onChange={(event) => onDayCostChange(event.target.value)}
          required
          step="0.01"
          type="number"
          value={dayCost}
        />
      </label>
    </div>
  )
}
