import {createClient, Entry} from 'contentful'
import * as core from '@actions/core'
import fse, {WriteOptions} from 'fs-extra'
import path from 'path'
import {IChangelist, LocalSyncCollection} from './@types/contentful'
import {AxiosRequestConfig, AxiosResponse} from 'axios'
import * as github from '@actions/github'
import {Context} from '@actions/github/lib/context'

/**
 * Contentful Changelist Sync - Github Action
 *
 * @author: Yan Kisen
 * @since: 10/07/2020
 */

let DEBUG_LEVEL: string | number = process.env.DEBUG_LEVEL || '2'
try {
  /*  === DEBUG_LEVEL Reference ===
   *
   *  0 = WARNING
   *  1 = INFO
   *  2 = DEBUG
   *  3 = TRACE
   */
  DEBUG_LEVEL = parseInt(DEBUG_LEVEL, 10)
} catch (e) {
  core.warning(
    `invalid setting for process.env.DEBUG_LEVEL... \\n ${DEBUG_LEVEL}`
  )
  DEBUG_LEVEL = 2
}

// TODO: there's probably a much better way of doing this, but here we are...
let INDENT_LEVEL: string | number = process.env.INDENT_LEVEL || '0'
try {
  INDENT_LEVEL = parseInt(INDENT_LEVEL, 10)
} catch (e) {
  core.warning(
    `invalid setting for process.env.INDENT_LEVEL... \\n ${INDENT_LEVEL}`
  )
  INDENT_LEVEL = 0
}

// NOTE: making this available here for quick modification for readability (but eliminating default spacing for the sake of file size)
const jsonWriteOptions: WriteOptions = {
  spaces: INDENT_LEVEL,
  replacer: null
}

let ctfSyncData: LocalSyncCollection
const ghContextData: Context = github.context

const CTF_SPACE_ID = process.env.CTF_SPACE_ID
// TODO: Sync with PreviewAPI in certain Branch Scenarios (maybe just set preview token & change host)
const CTF_CDA_ACCESS_TOKEN = process.env.CTF_CDA_ACCESS_TOKEN
const CTF_CPA_ACCESS_TOKEN = process.env.CTF_CPA_ACCESS_TOKEN // NOTE: Content Delivery API vs Content Preview API
const CTF_ENVIRONMENT_ID = process.env.CTF_ENVIRONMENT_ID || 'master'

async function run(): Promise<void> {
  try {
    // ## Process Inputs
    const changelistId: string = core.getInput('changelist-id')
    const usePreviewOnly: boolean = core.getInput('use-preview-api') === 'true' || false // only sync w/ previewAPI
    const ctfEnvironmentId: string =
      core.getInput('ctf-environment-id') || CTF_ENVIRONMENT_ID

    core.info(
      // NOTE: debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
      `ctf-changelist-sync | changelistId: [${changelistId}]] 
      \nuse-preview-api input: [${core.getInput('use-preview-api')}]
      \nusePreviewOnly: [${usePreviewOnly}]`
    )

    if (!CTF_SPACE_ID || !CTF_CDA_ACCESS_TOKEN || !CTF_CPA_ACCESS_TOKEN) {
      core.setFailed('Invalid Contentful Client config')
      return
    }

    const ctfCdaClient = createClient({
      space: CTF_SPACE_ID,
      accessToken: CTF_CDA_ACCESS_TOKEN,
      environment: ctfEnvironmentId,
      resolveLinks: false, // NOTE: we don't want to resolve the object graph
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      requestLogger: _requestLogger,
      responseLogger: _responseLogger
      // TODO: request/response logging is pretty obnoxious for a Sync Operation (too many requests... ) (Create separate Sync Loggers?)
    })

    const ctfPreviewClient = createClient({
      space: CTF_SPACE_ID,
      accessToken: CTF_CPA_ACCESS_TOKEN,
      environment: ctfEnvironmentId,
      host: 'preview.contentful.com',
      resolveLinks: false, // NOTE: we don't want to resolve the object graph
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      requestLogger: _requestLogger,
      responseLogger: _responseLogger
    })

    const initialSyncClient = usePreviewOnly ? ctfPreviewClient : ctfCdaClient

    // (1) Perform initial Sync
    const syncResult = await initialSyncClient.sync({
      type: 'all',
      initial: true
    })
    core.info(`executeSyncInit: [${syncResult.nextSyncToken}]`)

    // (2) If supplied, query by a changelist
    if (!changelistId || usePreviewOnly) {
      ctfSyncData = syncResult
    } else {
      const queryResults = await ctfPreviewClient.getEntries({
        content_type: 'changelist',
        'fields.changelistId': changelistId,
        select: 'sys.id,fields.entries',
        locale: '*',
        include: 1
      })

      if (queryResults.total === 0) {
        core.warning(`No valid Entries found for Changelist: [${changelistId}]. 
        Will continue with the original SyncCollection`)
        ctfSyncData = syncResult
      } else {
        console.log(queryResults)

        const changelist: IChangelist = queryResults.items[0] as IChangelist

        core.debug(`Changelist: \ 
      ${JSON.stringify(changelist, null, 1)}
      `)

        core.info(
          `Changelist [${changelistId}] contains ${changelist?.fields.entries?.length} entries`
        )

        // (3) Merge the JSON Data
        // TODO: I am sure there is a more efficient way of achieving this...
        // TODO/NOTE: For now we *only* deal with Entries, not Assets. However, convention implies that Assets would be wrapped by a "Media" ContentType

        const updatedEntries = changelist.fields.entries?.filter(item => {
          return syncResult.entries.filter(childItem => {
            return item.sys.id === childItem.sys.id
          })
        }) as Entry<any>[]
        const newEntries = changelist.fields.entries?.filter(item => {
          return syncResult.entries.filter(childItem => {
            return item.sys.id !== childItem.sys.id
          })
        }) as Entry<any>[]

        const updatedEntryIds = updatedEntries.map(item => item.sys.id)

        // (4.1) Modify Sync Collection
        ctfSyncData = {
          entries: syncResult.entries.map(originalEntry => {
            if (updatedEntryIds.includes(originalEntry.sys.id)) {
              return updatedEntries.find(
                item => item.sys.id === originalEntry.sys.id
              ) as Entry<any>
            }
            return originalEntry
          }),
          assets: syncResult.assets,

          deletedAssets: syncResult.deletedAssets,
          deletedEntries: syncResult.deletedEntries,
          nextSyncToken: syncResult.nextSyncToken
        }

        // (4.2) Concatenate *NEW* Entries to the Collection
        ctfSyncData.entries.concat(newEntries)
      }
    }

    _writeToFileCache()

    // TODO: think of something meaningful to output
    /*core.setOutput(
      'something',
      `There's always gotta be something.... ${new Date().toTimeString()}`
    )*/
  } catch (error) {
    core.error(error)
    core.setFailed(error.message)
  }
}

run()

/**
 * Save both the Contentful SyncCollection & Github Context JSON Data to be exported as artifacts.
 *
 * - TODO: do we care about the I/O operations not being async?
 * - TODO: We could use `@actions/artifact` here as well, instead of redeclaring as a separate step, but starting to feel like this Action is "doin' to much"
 */
function _writeToFileCache(): void {
  const workspaceDir: string = process.env.GITHUB_WORKSPACE || __dirname
  const cacheDir: string = path.resolve(
    workspaceDir,
    core.getInput('cache-dir-path')
  )
  const ctfFilePath = path.resolve(cacheDir, core.getInput('ctf-file-name'))
  const ghFilePath = path.resolve(cacheDir, core.getInput('gh-file-name'))

  try {
    fse.ensureDirSync(cacheDir)

    fse.outputJSONSync(ctfFilePath, ctfSyncData, jsonWriteOptions)

    core.info(`ctfSyncData saved successfully to [${ctfFilePath}]`)

    fse.outputJSONSync(ghFilePath, ghContextData, jsonWriteOptions)

    core.info(`ghContextData saved successfully to [${ghFilePath}]`)

    core.debug(JSON.stringify(ghContextData))
  } catch (error) {
    core.error(error)
    core.setFailed(error.message)
  }

  return
}

function _requestLogger(axiosRequestConfig: AxiosRequestConfig): void {
  const cleanedParams = delete {...axiosRequestConfig.params}['access_token']

  if (DEBUG_LEVEL > 2) {
    core.debug(
      `[requestLogger] | [/${axiosRequestConfig.url}] ${JSON.stringify(
        cleanedParams
      )}`
    ) // NOTE: `core.debug()` is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
  }
}

function _responseLogger(axiosResponse: AxiosResponse): void {
  const axiosRequestConfig = axiosResponse.config
  const cleanedParams = delete {...axiosRequestConfig.params}['access_token']

  if (axiosResponse.status >= 300) {
    core.warning(
      `[responseLogger] | [${axiosResponse.status}] | endpoint: [/${
        axiosRequestConfig.url
      }] \\n ${JSON.stringify(cleanedParams)}`
    )
  }

  if (DEBUG_LEVEL > 2) {
    core.debug(axiosResponse.data)
  }

  if (axiosResponse.data['errors']) {
    core.warning(
      `[responseLogger]  | Response contains errors | [${
        axiosResponse.status
      }] | endpoint: [/${axiosRequestConfig.url}]\\n[${JSON.stringify(
        axiosResponse.data['errors']
      )}]`
      // NOTE: These errors are in relation to Contentful Data, like unresolved references etc... Do we care about displaying them? Maybe only on the preview site? (Someone/thing should be notified...)
    )
  }
}
