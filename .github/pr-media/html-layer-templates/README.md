# HTML layer templates: PR media

Before/after sheets for the pull request that moves the cards of five bundled app templates into HTML layers. Each sheet stacks three frames of the template rendered before the change (top) and after it (bottom), at the same times.

Both renders run the Node engine (`compile()` from the built `dist`) with the library assets and the fields filled the way the builder fills them: `Camille Martin` / `Head of Product, Kiln Studio` / `What surprised you most this year?` for Interview, `Camille` for Present Yourself, `Moo Mug` / `Made for coffee breaks` / `EUR 24` for Product Launch, `LeClap` / `Your story in motion` / `Build your next scene` / `Create your first video` for Web App Promo, `Move your caption` / `Drag the text into place` for App Tutorial, and `Slow mornings` / `Find your rhythm` / `Make it count` for Story Reel. The clips are `video_1.mp4` and `video_portrait.mp4` from the creative-kit library, `examples/showcase/media/moo-mug.mp4` and `examples/showcase/media/leclap-canvas.mp4`.

Frames come from `ffmpeg -ss <t> -frames:v 1`, scaled to 480 px high, stacked with `hstack`/`vstack` and saved as WebP (quality 82). Story Reel's sheet puts each label under its frame, since its captions sit at the top and the bottom of the picture.
