'use client';

import { useState } from 'react';
import type { UIForm, UIField, UIAction } from '@/types/ai-ui';

interface Props {
  form: UIForm;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

export default function DynamicForm({ form, onAction, disabled }: Props) {
  const [formData, setFormData] = useState<Record<string, string>>({});

  function handleChange(name: string, value: string) {
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    onAction({
      componentType: 'form',
      payload: { type: 'submit', formData },
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-1 text-sm font-semibold text-gray-900">
        {form.title}
      </h3>
      {form.description && (
        <p className="mb-4 text-xs text-gray-500">{form.description}</p>
      )}

      <div className="space-y-3">
        {form.fields.map((field) => (
          <FormFieldRenderer
            key={field.name}
            field={field}
            value={formData[field.name] ?? ''}
            onChange={(v) => handleChange(field.name, v)}
            disabled={disabled}
          />
        ))}
      </div>

      <button
        type="submit"
        disabled={disabled}
        className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {form.submitLabel ?? '提交'}
      </button>
    </form>
  );
}

function FormFieldRenderer({
  field,
  value,
  onChange,
  disabled,
}: {
  field: UIField;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const baseClass =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50';

  switch (field.type) {
    case 'textarea':
      return (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {field.label}
            {field.required && <span className="ml-0.5 text-red-500">*</span>}
          </span>
          <textarea
            className={baseClass}
            rows={3}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        </label>
      );

    case 'select':
      return (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {field.label}
            {field.required && <span className="ml-0.5 text-red-500">*</span>}
          </span>
          <select
            className={baseClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">{field.placeholder ?? '请选择'}</option>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );

    case 'date':
      return (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {field.label}
            {field.required && <span className="ml-0.5 text-red-500">*</span>}
          </span>
          <input
            type="date"
            className={baseClass}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        </label>
      );

    case 'number':
      return (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {field.label}
            {field.required && <span className="ml-0.5 text-red-500">*</span>}
          </span>
          <input
            type="number"
            className={baseClass}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        </label>
      );

    case 'input':
    default:
      return (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {field.label}
            {field.required && <span className="ml-0.5 text-red-500">*</span>}
          </span>
          <input
            type="text"
            className={baseClass}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        </label>
      );
  }
}
