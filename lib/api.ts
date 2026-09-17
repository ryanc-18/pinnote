// ─── API Service Layer ────────────────────────────────────────────────────────
//
// Every function here talks to one API route and returns the result.
// Components import these functions instead of writing fetch() calls directly.
//

import type { Folder, Note } from '@/generated/prisma/client'

// ── Folders ───────────────────────────────────────────────────────────────────

export async function getWorkspaceData(): Promise<{ folders: (Folder & { notes: Note[] })[]; rootNotes: Note[] }> {
  const res = await fetch('/api/folders')
  if (!res.ok) throw new Error('Failed to load workspace')
  return res.json()
}

export async function createFolder(name: string, parentId?: string) {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  })
  if (!res.ok) throw new Error('Failed to create folder')
  return res.json()
}

export async function renameFolder(id: string, name: string) {
  const res = await fetch(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to rename folder')
  return res.json()
}

export async function moveFolderToFolder(id: string, parentId: string | null) {
  const res = await fetch(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId }),
  })
  if (!res.ok) throw new Error('Failed to move folder')
  return res.json()
}

export async function deleteFolder(id: string) {
  const res = await fetch(`/api/folders/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete folder')
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export async function createNote(title: string, content: string, folderId: string, pdfUrl?: string) {
  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, folderId, pdfUrl }),
  })
  if (!res.ok) throw new Error('Failed to create note')
  return res.json()
}

export async function moveNote(id: string, folderId: string) {
  const res = await fetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId }),
  })
  if (!res.ok) throw new Error('Failed to move note')
  return res.json()
}

export async function renameNote(id: string, title: string) {
  const res = await fetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error('Failed to rename note')
  return res.json()
}

export async function deleteNote(id: string) {
  const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete note')
}

// ── Annotations ───────────────────────────────────────────────────────────────

export async function getAnnotations(noteId: string) {
  const res = await fetch(`/api/notes/${noteId}/annotations`)
  if (!res.ok) throw new Error('Failed to load annotations')
  return res.json()
}

export async function createAnnotation(noteId: string, annotation: { page: number; x: number; y: number; number: number; text: string }) {
  const res = await fetch(`/api/notes/${noteId}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(annotation),
  })
  if (!res.ok) throw new Error('Failed to create annotation')
  return res.json()
}

export async function updateAnnotation(id: string, text: string) {
  const res = await fetch(`/api/annotations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error('Failed to update annotation')
  return res.json()
}

export async function deleteAnnotation(id: string) {
  const res = await fetch(`/api/annotations/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete annotation')
}

// ── File Upload ───────────────────────────────────────────────────────────────

export async function uploadPdf(file: File, folderId: string | null) {
  const form = new FormData()
  form.append('file', file)
  if (folderId) form.append('folderId', folderId)

  const res = await fetch('/api/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error('Failed to upload file')
  return res.json()
}
