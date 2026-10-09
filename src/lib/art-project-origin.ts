export interface SignatureProjectOrigin {
  kind: 'signature'
  projectId: string
  sha256: string
  name: string
  recipeId?: string
}

/** Local provenance never grants a commercial entitlement. */
export function readProjectOrigin(value: unknown): SignatureProjectOrigin | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('作品来源信息无效')
  const v = value as Record<string, unknown>
  if (
    v.kind !== 'signature' ||
    typeof v.projectId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,120}$/.test(v.projectId) ||
    typeof v.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.sha256) ||
    typeof v.name !== 'string' ||
    !v.name.length ||
    v.name.length > 60 ||
    /[\x00-\x1f]/.test(v.name) ||
    (v.recipeId !== undefined &&
      (typeof v.recipeId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(v.recipeId)))
  )
    throw new Error('作品来源信息无效')
  return {
    kind: 'signature',
    projectId: v.projectId,
    sha256: v.sha256,
    name: v.name,
    ...(v.recipeId === undefined ? {} : { recipeId: v.recipeId as string }),
  }
}
