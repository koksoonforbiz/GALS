import { useCallback } from 'react';
import RichTextEditor from '../RichTextEditor';
import type { TextBlockData } from '../block-types';

interface Props {
  data: TextBlockData;
  onChange: (data: TextBlockData) => void;
  readOnly?: boolean;
}

export default function TextBlock({ data, onChange, readOnly }: Props) {
  const handleSave = useCallback(
    (html: string) => {
      onChange({ html });
    },
    [onChange],
  );

  return (
    <RichTextEditor
      content={data.html}
      onSave={handleSave}
      placeholder="Start writing..."
      readOnly={readOnly}
      autoSaveMs={1500}
    />
  );
}
