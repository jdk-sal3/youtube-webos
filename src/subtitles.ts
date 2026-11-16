import { configRead } from './config';
import { processPlayerResponse } from './subtitles-core';

const originalParse = JSON.parse;

function jsonParse(this: unknown, ...args: Parameters<typeof JSON.parse>) {
  const parsed = originalParse.apply(this, args) as unknown;

  if (!configRead('forceEnglishSubtitles')) {
    return parsed;
  }

  try {
    return processPlayerResponse(parsed);
  } catch (err) {
    console.warn('[subtitles] Failed to process captions', err);
    return parsed;
  }
}

JSON.parse = jsonParse;
