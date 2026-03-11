chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'trigger-khan-primary-action') {
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'khan-primary-action'
    });
  } catch (error) {
    console.warn('[KA tracker] Failed to send primary action command', error);
  }
});
