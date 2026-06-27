'use client';

import type { UIComponent, UIAction } from '@/types/ai-ui';
import SelectionCard from './SelectionCard';
import DynamicForm from './DynamicForm';
import ConfirmationDialog from './ConfirmationDialog';
import InfoCard from './InfoCard';
import StepsProgress from './StepsProgress';
import DataTable from './DataTable';
import ActionButtons from './ActionButtons';

interface Props {
  component: UIComponent;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

export default function ComponentRenderer({ component, onAction, disabled }: Props) {
  switch (component.type) {
    case 'text':
      return (
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
          {component.content}
        </div>
      );

    case 'selection':
      return (
        <SelectionCard
          selection={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case 'form':
      return (
        <DynamicForm
          form={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case 'confirmation':
      return (
        <ConfirmationDialog
          confirmation={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case 'card':
      return <InfoCard card={component} />;

    case 'steps':
      return <StepsProgress steps={component} />;

    case 'table':
      return <DataTable table={component} />;

    case 'action_buttons':
      return (
        <ActionButtons
          actions={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    default:
      return null;
  }
}
