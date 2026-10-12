// Upload a committed evidence video as a GitHub attachment and return its `user-attachments` URL, the only kind of
// video link GitHub plays inline. Run it in the PR's own page, in the user's logged-in browser, through the agent's
// browser tool (Claude in Chrome's JavaScript tool, or the equivalent in Codex). There is no API for these uploads:
// it has to be the user's session.
//
// The page fetches the .mp4 from its pinned raw.githubusercontent.com URL (public, CORS-open), so the browser tool
// needs no access to local files. It drops the file into the PR's comment box, the same upload as a drag-and-drop,
// waits for GitHub to insert the attachment link, reads it, then restores the box: nothing is posted. The caller
// then writes the URL into the description with `gh pr edit`.
//
// Usage: paste this function, then call it, e.g.
//   await attachVideo('https://raw.githubusercontent.com/heristop/leclap/<full-sha>/.github/pr-media/<slug>/evidence.mp4')
async function attachVideo(rawUrl, name = rawUrl.split('/').pop()) {
  const ATTACHMENT = /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+/;
  const textarea =
    document.querySelector('#new_comment_field') ??
    document.querySelector('textarea[name="comment[body]"]') ??
    [...document.querySelectorAll('textarea')].findLast((field) => field.offsetParent !== null);

  if (!textarea) throw new Error('No comment box on this page: open the PR conversation, logged in.');

  const response = await fetch(rawUrl);

  if (!response.ok) throw new Error(`Fetching ${rawUrl} failed: ${response.status}. Is the commit pushed?`);

  const file = new File([await response.blob()], name, { type: 'video/mp4' });
  const transfer = new DataTransfer();

  transfer.items.add(file);
  const before = textarea.value;
  const form = textarea.closest('form, file-attachment, [class*="MarkdownEditor"]') ?? document;
  const input = form.querySelector('input[type="file"]');

  // The editor's own file input when it has one; a drop on the field otherwise (both are GitHub's drag-and-drop path).
  if (input) {
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (!input)
    textarea.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));

  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const match = textarea.value.match(ATTACHMENT);

    if (match) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

      setter.call(textarea, before);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      return match[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('GitHub inserted no attachment link within 2 minutes: check the file is under 10 MB.');
}
