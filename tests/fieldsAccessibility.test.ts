import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Checkbox,
  RadioGroup,
  SelectField,
  TextAreaField,
  TextField,
} from '../src/components/fields';

describe('field accessibility', () => {
  it('associates help, counters and errors without creating a burst of live alerts', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(TextField, {
          label: 'Title',
          help: 'Keep it concrete.',
          value: '',
          onChange: () => {},
          error: 'A title is required.',
          required: true,
        }),
        createElement(TextAreaField, {
          label: 'Abstract',
          help: 'This is published.',
          value: '',
          onChange: () => {},
          error: 'An abstract is required.',
          minLength: 20,
          maxLength: 100,
          required: true,
        }),
        createElement(SelectField, {
          label: 'Category',
          help: 'Choose the closest one.',
          value: '',
          options: [{ value: 'web', label: 'Web' }],
          onChange: () => {},
          error: 'Choose a category.',
          required: true,
        }),
        createElement(RadioGroup, {
          label: 'Travel',
          help: 'Tell us what is realistic.',
          value: '',
          options: [
            { value: 'local', label: 'Local' },
            { value: 'travelling', label: 'Travelling' },
          ],
          onChange: () => {},
          error: 'Choose one.',
          required: true,
        }),
        createElement(Checkbox, {
          label: 'Conflict of interest',
          help: 'Conflicted reviews do not count toward the score.',
          checked: false,
          onChange: () => {},
          error: 'Check this if it applies.',
        }),
      ),
    );

    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-required="true"');

    const referencedIds = [
      ...Array.from(markup.matchAll(/aria-describedby="([^"]+)"/g), (match) =>
        match[1].split(' '),
      ).flat(),
      ...Array.from(markup.matchAll(/aria-errormessage="([^"]+)"/g), (match) => match[1]),
    ];

    expect(referencedIds.length).toBeGreaterThan(0);
    for (const id of referencedIds) {
      expect(markup).toContain(`id="${id}"`);
    }
  });
});
