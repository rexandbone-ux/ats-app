import { embedOf, rawDbx } from "@/lib/media";

describe("rawDbx", () => {
  it("rewrites a dropbox share host to the raw content host", () => {
    expect(rawDbx("https://www.dropbox.com/s/abc/file.mp4?dl=0")).toBe(
      "https://dl.dropboxusercontent.com/s/abc/file.mp4?raw=1"
    );
  });

  it("rewrites dl=0 when it appears after an ampersand", () => {
    expect(rawDbx("https://www.dropbox.com/s/x/f.pdf?rlkey=k&dl=0")).toBe(
      "https://dl.dropboxusercontent.com/s/x/f.pdf?rlkey=k&raw=1"
    );
  });

  it("leaves non-dropbox urls untouched", () => {
    const url = "https://example.com/video.mp4";
    expect(rawDbx(url)).toBe(url);
  });
});

describe("embedOf", () => {
  it("returns null for empty or whitespace input", () => {
    expect(embedOf("")).toBeNull();
    expect(embedOf("   ")).toBeNull();
  });

  it("returns null for an unsupported url", () => {
    expect(embedOf("https://example.com/page")).toBeNull();
  });

  it("detects vocaroo links as audio embeds", () => {
    expect(embedOf("https://vocaroo.com/1abcDEF")).toEqual({
      type: "audio",
      src: "https://vocaroo.com/embed/1abcDEF?autoplay=0",
    });
  });

  it("detects voca.ro short links as audio embeds", () => {
    expect(embedOf("https://voca.ro/embed/xyz123")).toEqual({
      type: "audio",
      src: "https://vocaroo.com/embed/xyz123?autoplay=0",
    });
  });

  it("detects loom share links as iframe embeds", () => {
    expect(embedOf("https://www.loom.com/share/abc123")).toEqual({
      type: "iframe",
      src: "https://www.loom.com/embed/abc123",
    });
  });

  it("detects youtube watch links as iframe embeds", () => {
    expect(embedOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      type: "iframe",
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });

  it("detects youtu.be short links as iframe embeds", () => {
    expect(embedOf("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      type: "iframe",
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });

  it("detects google drive file links as iframe embeds", () => {
    expect(embedOf("https://drive.google.com/file/d/FILEID123/view")).toEqual({
      type: "iframe",
      src: "https://drive.google.com/file/d/FILEID123/preview",
    });
  });

  it("detects video files by extension", () => {
    expect(embedOf("https://example.com/clip.webm")).toEqual({
      type: "video",
      src: "https://example.com/clip.webm",
    });
  });

  it("detects audio files by extension", () => {
    expect(embedOf("https://example.com/take.mp3")).toEqual({
      type: "audiofile",
      src: "https://example.com/take.mp3",
    });
  });

  it("detects pdf files by extension", () => {
    expect(embedOf("https://example.com/resume.pdf")).toEqual({
      type: "pdf",
      src: "https://example.com/resume.pdf",
    });
  });

  it("rewrites dropbox file urls through rawDbx", () => {
    expect(embedOf("https://www.dropbox.com/s/a/resume.pdf?dl=0")).toEqual({
      type: "pdf",
      src: "https://dl.dropboxusercontent.com/s/a/resume.pdf?raw=1",
    });
  });

  it("trims surrounding whitespace before matching", () => {
    expect(embedOf("   https://youtu.be/abcDEF123   ")).toEqual({
      type: "iframe",
      src: "https://www.youtube.com/embed/abcDEF123",
    });
  });

  it("matches file extensions even with query strings", () => {
    expect(embedOf("https://cdn.example.com/a.mov?token=xyz")).toEqual({
      type: "video",
      src: "https://cdn.example.com/a.mov?token=xyz",
    });
  });
});
