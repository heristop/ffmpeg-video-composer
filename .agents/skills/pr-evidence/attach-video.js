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
// Usage: paste this file, then call it, e.g.
//   await attachVideo('https://raw.githubusercontent.com/heristop/leclap/<full-sha>/.github/pr-media/<slug>/evidence.mp4')

const ATTACHMENT = /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+/;
const TIMEOUT_MS = 120_000;

function commentBox() {
  const box =
    document.querySelector('#new_comment_field') ??
    document.querySelector('textarea[name="comment[body]"]') ??
    [...document.querySelectorAll('textarea')].findLast((field) => field.offsetParent !== null);

  if (!box) throw new Error('No comment box on this page: open the PR conversation, logged in.');

  return box;
}

async function fetchVideo(rawUrl, name) {
  const response = await fetch(rawUrl);

  if (!response.ok) throw new Error(`Fetching ${rawUrl} failed: ${response.status}. Is the commit pushed?`);

  const transfer = new DataTransfer();

  transfer.items.add(new File([await response.blob()], name, { type: 'video/mp4' }));

  return transfer;
}

// The editor's own file input when it has one; a drop on the field otherwise (both are GitHub's drag-and-drop path).
function drop(box, transfer) {
  const scope = box.closest('form, file-attachment, [class*="MarkdownEditor"]') ?? document;
  const input = scope.querySelector('input[type="file"]');

  if (!input) {
    box.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));

    return;
  }

  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function waitForLink(box, deadline) {
  const match = box.value.match(ATTACHMENT);

  if (match) return Promise.resolve(match[0]);

  if (Date.now() > deadline) {
    return Promise.reject(new Error('GitHub inserted no attachment link within 2 minutes: is the file under 10 MB?'));
  }

  return new Promise((resolve) => {
    setTimeout(resolve, 500);
  }).then(() => waitForLink(box, deadline));
}

// Put the box back as it was. setRangeText changes the text without the value setter, so a React-driven editor still
// sees the change on the input event and keeps its state in step.
function restore(box, text) {
  box.setRangeText(text, 0, box.value.length, 'end');
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

globalThis.attachVideo = async (rawUrl, name = rawUrl.split('/').pop()) => {
  const box = commentBox();
  const before = box.value;

  drop(box, await fetchVideo(rawUrl, name));
  const link = await waitForLink(box, Date.now() + TIMEOUT_MS);

  restore(box, before);

  return link;
};
