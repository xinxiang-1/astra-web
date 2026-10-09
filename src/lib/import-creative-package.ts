import { importCreativeWorkflow, saveArtProject, saveSignatureProject } from './art-projects'
import { assertArtProjectEngineCompatible, readArtProjectPackage } from './art-project-package'
import { CREATIVE_WORKFLOW_ACCEPT, readCreativeWorkflowPackage } from './creative-workflow-package'
import {
  SIGNATURE_PROJECT_ACCEPT,
  SIGNATURE_PROJECT_ENGINE,
  readSignatureProject,
} from './signature-portrait/project'
import { exportSignaturePng } from './signature-portrait/png-export'
import { signatureProjectThumbnail } from './signature-project-thumbnail'

export function creativePackageImportLabel(filename: string): string | null {
  const name = filename.toLowerCase()
  if (name.endsWith(CREATIVE_WORKFLOW_ACCEPT)) return '导入完整工作流'
  if (name.endsWith(SIGNATURE_PROJECT_ACCEPT)) return '导入签名原作'
  return name.endsWith('.astra') ? '导入为新项目' : null
}

/** Both local files and verified private downloads use the same strict readers and transactions. */
export async function importCreativePackage(
  file: File,
  options: { signal: AbortSignal; beforeSave?: () => void },
): Promise<string> {
  const { signal } = options
  const persist = async (save: () => Promise<unknown>) => {
    signal.throwIfAborted()
    options.beforeSave?.()
    signal.throwIfAborted()
    try {
      await save()
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted()
      throw new Error('浏览器未能保存项目，请检查存储空间或先下载作品包备份。', { cause: error })
    }
  }
  const thumbnail = async (project: Parameters<typeof exportSignaturePng>[0]) =>
    signatureProjectThumbnail(
      await exportSignaturePng(project, {
        longEdge: 420,
        signal: {
          get cancelled() {
            return signal.aborted
          },
        },
      }),
      signal,
    )
  signal.throwIfAborted()
  if (file.name.toLowerCase().endsWith(CREATIVE_WORKFLOW_ACCEPT)) {
    const restored = await readCreativeWorkflowPackage(file, signal)
    try {
      const preview = await thumbnail(restored.signature)
      let reused = false
      await persist(async () => {
        const saved = await importCreativeWorkflow(
          {
            file: restored.signatureFile,
            name: restored.project.origin!.name,
            thumbnail: preview,
            engineVersion: SIGNATURE_PROJECT_ENGINE,
          },
          restored.project,
          restored.workflowKey,
          signal,
        )
        reused = saved.reused
      })
      return reused
        ? '此工作流版本已导入，签名原作与字符派生保持完整。'
        : '工作流已导入，签名原作与字符派生已一起保存；本地已有改动会保留。字符字体可能随设备变化。'
    } finally {
      restored.dispose()
    }
  }
  if (file.name.toLowerCase().endsWith(SIGNATURE_PROJECT_ACCEPT)) {
    const restored = await readSignatureProject(file, { signal })
    try {
      const preview = await thumbnail(restored.project)
      await persist(() =>
        saveSignatureProject(
          {
            file,
            name: restored.project.portraitName,
            thumbnail: preview,
            engineVersion: SIGNATURE_PROJECT_ENGINE,
          },
          signal,
        ),
      )
      return '签名原作已保存到我的项目，可继续编辑。相同版本不会重复添加。'
    } finally {
      restored.dispose()
    }
  }
  const result = await readArtProjectPackage(file)
  assertArtProjectEngineCompatible(result.project)
  await persist(() => saveArtProject(result.project, signal))
  return result.notice
}
