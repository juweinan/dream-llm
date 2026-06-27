'use client';

import type { UISelection, UIAction } from '@/types/ai-ui';

interface Props {
  selection: UISelection;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

export default function SelectionCard({ selection, onAction, disabled }: Props) {
  function handleSelect(value: string, label: string) {
    if (disabled) return;
    onAction({
      componentType: 'selection',
      payload: { type: 'select', selectedId: value, selectedLabel: label },
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">
        {selection.title}
      </h3>
      {selection.description && (
        <p className="mb-3 text-xs text-gray-500">{selection.description}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {selection.options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleSelect(opt.value, opt.label)}
            disabled={disabled}
            className="rounded-md border border-gray-200 px-3 py-2.5 text-left text-sm transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium text-gray-800">{opt.label}</div>
            {opt.description && (
              <div className="mt-0.5 text-xs text-gray-500">
                {opt.description}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
