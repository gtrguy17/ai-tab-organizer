import { chunk } from 'lodash-es';

import { collectTabs, mergeCategories, organizeTabs } from './categories';
import { analyzeTabs } from './openai';

const mapTabIds = (tabs: chrome.tabs.Tab[]) => (
  tabs
    .map((tab) => tab.id)
    .filter((id): id is number => !!id)
);

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  const forCurrentWindow = false;

  if (message.action === 'action-closeblanks') {
    chrome.tabs.query({ currentWindow: forCurrentWindow }, (tabs) => {
      const blankTabs = tabs.filter((tab) => tab.url === 'chrome://newtab/');

      console.log(`Found ${blankTabs.length} blank tabs, closing`);

      chrome.tabs.remove(mapTabIds(blankTabs));
    });
  } else if (message.action === 'action-deduplicate') {
    chrome.tabs.query({ currentWindow: forCurrentWindow }, (tabs) => {
      const urls = tabs.map((tab) => tab.url);
      const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);
      const duplicateTabs = tabs.filter((tab) => duplicates.includes(tab.url));

      console.log(`Found ${duplicateTabs.length} duplicate tabs, closing`);

      chrome.tabs.remove(mapTabIds(duplicateTabs));
    });
  } else if (message.action === 'action-ai') {
    await organizeViaAi();
  }
});

const organizeViaAi = async () => {
  const { apiKey, aiModel } = await chrome.storage.sync.get({
    apiKey: '',
    aiModel: '',
  });

  if (!apiKey) {
    console.error('No API key found');
    return;
  }

  const tabs = await collectTabs();
  const chunks = chunk(tabs, 60);

  const categories = await Promise.all(
    chunks.map((chunk) => analyzeTabs({
      model: aiModel,
      apiKey,
    }, chunk)),
  );

  console.log("Got all results, now merging");

  const allMatchedTabIds = categories.flatMap((category) => category.tabs);
  const allTabIds = tabs.map((tab) => tab.id);

  // Make sure the returned Tab IDs are actually valid
  const invalidTabIds = allMatchedTabIds.filter((id) => !allTabIds.includes(id));

  if (invalidTabIds.length > 0) {
    console.warn(`Got invalid Tab IDs: ${invalidTabIds.join(', ')}`);
    categories.push({
      "Other": invalidTabIds,
    });
  }

  // Find out if we have any tabs that have not been categorized
  const leftovers = allTabIds.filter((id) => !allMatchedTabIds.includes(id));

  if (leftovers.length > 0) {
    console.warn(`Got leftover Tab IDs: ${leftovers.join(', ')}`);
    categories.push({
      "Other": leftovers,
    });
  }

  // Merge shared categories
  const merged = mergeCategories(categories);
  console.log(merged);

  organizeTabs(merged);
  console.log("Done");
};
