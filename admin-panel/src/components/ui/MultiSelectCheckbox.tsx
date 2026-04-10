'use client';

import { useMemo, useState } from 'react';

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectCheckboxProps {
  id?: string;
  label?: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  error?: string;
  searchPlaceholder?: string;
}

export function MultiSelectCheckbox({
  id,
  label,
  options,
  value,
  onChange,
  disabled,
  error,
  searchPlaceholder = 'Search centers...',
}: MultiSelectCheckboxProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const selectedValues = useMemo(() => new Set(value), [value]);

  const selectedOptions = useMemo(() => {
    const labelByValue = new Map(
      options.map((option) => [option.value, option.label])
    );

    return value.map((selectedValue) => ({
      value: selectedValue,
      label: labelByValue.get(selectedValue) ?? selectedValue,
    }));
  }, [options, value]);

  const filteredOptions = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();

    if (!normalizedSearchTerm) {
      return options;
    }

    return options.filter((option) =>
      option.label.toLowerCase().includes(normalizedSearchTerm)
    );
  }, [options, searchTerm]);

  const selectedCount = value.length;
  const visibleSelectedChips = selectedOptions.slice(0, 6);
  const hiddenSelectedChipCount = Math.max(selectedOptions.length - 6, 0);
  const allVisibleSelected =
    filteredOptions.length > 0 &&
    filteredOptions.every((option) => selectedValues.has(option.value));

  const removeOption = (optionValue: string) => {
    if (disabled) {
      return;
    }

    onChange(value.filter((existingValue) => existingValue !== optionValue));
  };

  const toggleOption = (optionValue: string) => {
    if (disabled) {
      return;
    }

    if (selectedValues.has(optionValue)) {
      onChange(value.filter((existingValue) => existingValue !== optionValue));
      return;
    }

    onChange([...value, optionValue]);
  };

  const toggleVisibleOptions = () => {
    if (disabled || filteredOptions.length === 0) {
      return;
    }

    if (allVisibleSelected) {
      const filteredValues = new Set(filteredOptions.map((option) => option.value));
      onChange(value.filter((existingValue) => !filteredValues.has(existingValue)));
      return;
    }

    const nextValues = [...value];
    for (const option of filteredOptions) {
      if (!selectedValues.has(option.value)) {
        nextValues.push(option.value);
      }
    }
    onChange(nextValues);
  };

  const clearSelection = () => {
    if (disabled || value.length === 0) {
      return;
    }

    onChange([]);
  };

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
        >
          {label}
        </label>
      )}

      <div
        className={`rounded-lg border bg-white dark:bg-slate-900 ${
          error
            ? 'border-red-500'
            : 'border-slate-300 dark:border-slate-700'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-800">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {selectedCount === 0
              ? 'No center selected'
              : `${selectedCount} center${selectedCount === 1 ? '' : 's'} selected`}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleVisibleOptions}
              disabled={disabled || filteredOptions.length === 0}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:text-slate-400 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:text-slate-200"
            >
              {allVisibleSelected ? 'Unselect visible' : 'Select visible'}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={disabled || value.length === 0}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:text-slate-400 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear
            </button>
          </div>
        </div>

        {selectedOptions.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap gap-2">
              {visibleSelectedChips.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => removeOption(option.value)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed"
                >
                  <span className="truncate max-w-40">{option.label}</span>
                  <span aria-hidden>×</span>
                </button>
              ))}

              {hiddenSelectedChipCount > 0 && (
                <span className="inline-flex items-center rounded-full border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs text-slate-600 dark:text-slate-300">
                  +{hiddenSelectedChipCount} more
                </span>
              )}
            </div>
          </div>
        )}

        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">
          <input
            id={id}
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={searchPlaceholder}
            disabled={disabled}
            className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-slate-300 focus:border-slate-400 disabled:cursor-not-allowed"
          />
        </div>

        <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {filteredOptions.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400 text-center">
              {searchTerm.trim()
                ? 'No centers match your search'
                : 'No centers available'}
            </p>
          ) : (
            filteredOptions.map((option) => {
              const isSelected = selectedValues.has(option.value);

              return (
                <label
                  key={option.value}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-slate-50 dark:bg-slate-800/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOption(option.value)}
                    disabled={disabled}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
                  />
                  <span className="text-sm text-slate-800 dark:text-slate-200">
                    {option.label}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>

      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
    </div>
  );
}
