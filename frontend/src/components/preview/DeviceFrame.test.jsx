import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import DeviceFrame, { FRAME_DOC } from './DeviceFrame';

// jsdom doesn't load `srcdoc`: the iframe keeps its about:blank document. These tests fire the load
// event themselves where needed and check what DeviceFrame does once the frame's document is ready.
const renderFrame = () => {
  const utils = render(
    <DeviceFrame device="mobile" width="390px">
      <p>article body</p>
    </DeviceFrame>,
  );
  const iframe = utils.container.querySelector('iframe');
  return { ...utils, iframe };
};

const loadFrame = async (iframe) => {
  await act(async () => { fireEvent.load(iframe); });
  return iframe.contentDocument;
};

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

describe('DeviceFrame', () => {
  it('gives the iframe a srcdoc document, so embeds inside it get a referrer', () => {
    const { iframe } = renderFrame();
    // A src-less iframe's about:blank document sends no Referer, and YouTube then shows Error 153.
    expect(iframe.getAttribute('srcdoc')).toBe(FRAME_DOC);
    expect(FRAME_DOC.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(iframe.hasAttribute('src')).toBe(false);
  });

  it('renders the children inside the frame once it has loaded', async () => {
    const { iframe, container } = renderFrame();
    const doc = await loadFrame(iframe);
    await waitFor(() => expect(doc.body.textContent).toContain('article body'));
    expect(container.querySelector('.device-frame > p')).toBeNull();
  });

  it('copies the app styles and mirrors the theme into the frame', async () => {
    const style = document.createElement('style');
    style.textContent = '.marker-rule { color: red; }';
    document.head.appendChild(style);
    try {
      const { iframe } = renderFrame();
      const doc = await loadFrame(iframe);
      expect(doc.head.querySelector('[data-preview-style]').textContent).toContain('.marker-rule');

      await act(async () => { document.documentElement.setAttribute('data-theme', 'light'); });
      await waitFor(() => expect(doc.documentElement.getAttribute('data-theme')).toBe('light'));

      await act(async () => { document.documentElement.removeAttribute('data-theme'); });
      await waitFor(() => expect(doc.documentElement.hasAttribute('data-theme')).toBe(false));
    } finally {
      style.remove();
    }
  });

  it('does not duplicate the copied styles when the frame loads twice', async () => {
    const style = document.createElement('style');
    style.textContent = '.marker-rule { color: red; }';
    document.head.appendChild(style);
    try {
      const { iframe } = renderFrame();
      await loadFrame(iframe);
      const doc = await loadFrame(iframe);
      expect(doc.head.querySelectorAll('style[data-preview-style]')).toHaveLength(1);
      await waitFor(() => expect(doc.body.textContent).toContain('article body'));
    } finally {
      style.remove();
    }
  });
});
