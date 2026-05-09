import type { StoryProject } from '@/types/project'
import type { Character } from '@/types/character'
import JSZip from 'jszip'

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function textToXhtml(body: string, title: string): string {
  // Convert plain text / markdown-ish content to basic XHTML paragraphs
  const paragraphs = body
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      // Preserve single newlines as <br/> within a paragraph
      const lines = p.split('\n').map(line => escapeXml(line)).join('<br/>\n')
      return `    <p>${lines}</p>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
${paragraphs}
</body>
</html>`
}

function buildContentOpf(project: StoryProject, chapterFiles: string[], hasCharacters: boolean): string {
  const manifestItems: string[] = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="style" href="style.css" media-type="text/css"/>',
    '    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
  ]

  if (hasCharacters) {
    manifestItems.push('    <item id="characters" href="characters.xhtml" media-type="application/xhtml+xml"/>')
  }

  const spineItems: string[] = [
    '    <itemref idref="title"/>',
  ]

  if (hasCharacters) {
    spineItems.push('    <itemref idref="characters"/>')
  }

  for (let i = 0; i < chapterFiles.length; i++) {
    const id = `chapter-${i + 1}`
    const file = chapterFiles[i]
    manifestItems.push(`    <item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`)
    spineItems.push(`    <itemref idref="${id}"/>`)
  }

  const now = new Date().toISOString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${project.id}</dc:identifier>
    <dc:title>${escapeXml(project.name)}</dc:title>
    <dc:language>en</dc:language>
    <dc:date>${now.slice(0, 10)}</dc:date>
    ${project.summary ? `<dc:description>${escapeXml(project.summary)}</dc:description>` : ''}
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine>
${spineItems.join('\n')}
  </spine>
</package>`
}

function buildNavXhtml(project: StoryProject, chapterFiles: string[], hasCharacters: boolean): string {
  const tocEntries: string[] = []

  if (hasCharacters) {
    tocEntries.push('      <li><a href="characters.xhtml">Characters</a></li>')
  }

  for (let i = 0; i < project.chapters.length; i++) {
    const chapter = project.chapters[i]
    const file = chapterFiles[i]
    tocEntries.push(`      <li><a href="${file}">Chapter ${i + 1}: ${escapeXml(chapter.title)}</a></li>`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Table of Contents</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
${tocEntries.join('\n')}
    </ol>
  </nav>
</body>
</html>`
}

function buildTitlePage(project: StoryProject): string {
  const meta: string[] = []
  meta.push(`<p><strong>Genre:</strong> ${escapeXml(project.genre)}</p>`)
  meta.push(`<p><strong>Theme:</strong> ${escapeXml(project.theme)}</p>`)
  meta.push(`<p><strong>Target Reader:</strong> ${escapeXml(project.targetReader)}</p>`)
  meta.push(`<p><strong>Length:</strong> ${escapeXml(project.length)}</p>`)

  if (project.summary) {
    meta.push(`<blockquote>${escapeXml(project.summary)}</blockquote>`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(project.name)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <div style="text-align:center; margin-top: 30%;">
    <h1 style="font-size:2em; margin-bottom:0.5em;">${escapeXml(project.name)}</h1>
    <hr style="width:30%; margin:1em auto;"/>
  </div>
  <div style="margin-top:2em;">
${meta.join('\n')}
  </div>
</body>
</html>`
}

function buildCharactersPage(characters: Character[]): string {
  const entries = characters.map(char => {
    const parts: string[] = []
    parts.push(`    <h2>${escapeXml(char.name)}</h2>`)
    parts.push(`    <p><strong>Role:</strong> ${escapeXml(char.role)}</p>`)
    if (char.personality.length) {
      parts.push(`    <p><strong>Personality:</strong> ${escapeXml(char.personality.join(', '))}</p>`)
    }
    if (char.appearance) {
      parts.push(`    <p><strong>Appearance:</strong> ${escapeXml(char.appearance)}</p>`)
    }
    if (char.motivation) {
      parts.push(`    <p><strong>Motivation:</strong> ${escapeXml(char.motivation)}</p>`)
    }
    if (char.goals) {
      parts.push(`    <p><strong>Goals:</strong> ${escapeXml(char.goals)}</p>`)
    }
    if (char.backstory) {
      parts.push(`    <p><strong>Backstory:</strong> ${escapeXml(char.backstory)}</p>`)
    }
    return parts.join('\n')
  }).join('\n    <hr/>\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Characters</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>Characters</h1>
  <div>
${entries}
  </div>
</body>
</html>`
}

const EPUB_CSS = `
body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.6;
  margin: 1em;
  color: #333;
}
h1 {
  font-size: 1.5em;
  margin-bottom: 0.8em;
  color: #111;
}
h2 {
  font-size: 1.2em;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  color: #222;
}
p {
  margin: 0.6em 0;
  text-indent: 1.5em;
}
p:first-of-type {
  text-indent: 0;
}
blockquote {
  margin: 1em 2em;
  padding: 0.5em 1em;
  border-left: 3px solid #ccc;
  font-style: italic;
  color: #555;
}
hr {
  border: none;
  border-top: 1px solid #ddd;
  margin: 1.5em 0;
}
strong {
  color: #222;
}
`

export async function exportToEpub(project: StoryProject): Promise<Uint8Array> {
  const zip = new JSZip()

  // mimetype must be first and uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  // META-INF/container.xml
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)

  // OEBPS/style.css
  zip.file('OEBPS/style.css', EPUB_CSS)

  // OEBPS/title.xhtml
  zip.file('OEBPS/title.xhtml', buildTitlePage(project))

  // OEBPS/characters.xhtml
  const hasCharacters = project.characters.length > 0
  if (hasCharacters) {
    zip.file('OEBPS/characters.xhtml', buildCharactersPage(project.characters))
  }

  // Chapter files
  const chapterFiles: string[] = []
  for (let i = 0; i < project.chapters.length; i++) {
    const chapter = project.chapters[i]
    const content = chapter.polishedContent || chapter.content
    if (!content) continue

    const filename = `chapter-${i + 1}.xhtml`
    chapterFiles.push(filename)
    zip.file(`OEBPS/${filename}`, textToXhtml(content, `Chapter ${i + 1}: ${chapter.title}`))
  }

  // If no chapters with content, add a placeholder
  if (chapterFiles.length === 0) {
    const placeholder = textToXhtml('This story has no chapter content yet.', 'No Content')
    zip.file('OEBPS/no-content.xhtml', placeholder)
    chapterFiles.push('no-content.xhtml')
  }

  // content.opf
  zip.file('OEBPS/content.opf', buildContentOpf(project, chapterFiles, hasCharacters))

  // nav.xhtml
  zip.file('OEBPS/nav.xhtml', buildNavXhtml(project, chapterFiles, hasCharacters))

  return zip.generateAsync({ type: 'uint8array' })
}
