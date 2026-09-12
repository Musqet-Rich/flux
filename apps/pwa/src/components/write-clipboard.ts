// Put text on the clipboard and say whether it took. The async clipboard is missing off HTTPS
// (a box reached over plain http on the LAN) and can be refused; neither is worth an unhandled
// rejection, so every Copy button reports the outcome on its face instead.
export const writeClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
