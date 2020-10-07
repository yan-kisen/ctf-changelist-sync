import {createClient, Entry} from 'contentful'
import * as core from '@actions/core'
import fse from 'fs-extra'
import path from 'path'
import {IChangelist, LocalSyncCollection} from './@types/contentful'
import {AxiosRequestConfig, AxiosResponse} from 'axios'

/**  === DEBUG_LEVEL Reference ===
 *
 *  0 = WARNING
 *  1 = INFO
 *  2 = DEBUG
 *  3 = TRACE
 */

let DEBUG_LEVEL: string | number = process.env.DEBUG_LEVEL || '2'
try {
  DEBUG_LEVEL = parseInt(DEBUG_LEVEL, 10)
} catch (e) {
  core.warning(
    `invalid setting for process.env.DEBUG_LEVEL... \\n ${DEBUG_LEVEL}`
  )
  DEBUG_LEVEL = 2
}

async function run(): Promise<void> {
  try {
    // ## Process Inputs
    const changelistId: string = core.getInput('changelist-id')
    let syncFilePath: string = core.getInput('sync-file-path')
    const workspaceDir: string = process.env.GITHUB_WORKSPACE || __dirname

    core.debug(`ctf-changelist-sync | arbitrary debug message`) // NOTE: debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
    core.info(`ctf-changelist-sync | changelistId: [${changelistId}]`)

    core.info(
      `ctf-changelist-sync | syncFilePath: [${syncFilePath}] | workspaceDir: [${workspaceDir}]`
    )

    syncFilePath = path.resolve(workspaceDir, syncFilePath)

    // ## Fetch from Contentful

    let resultCollection: LocalSyncCollection
    // ## Configuration variables

    const CTF_SPACE_ID = process.env.CTF_SPACE_ID
    const CTF_CDA_ACCESS_TOKEN = process.env.CTF_CDA_ACCESS_TOKEN
    const CTF_CPA_ACCESS_TOKEN = process.env.CTF_CPA_ACCESS_TOKEN // NOTE: Content Delivery API vs Content Preview API
    const CTF_ENVIRONMENT_ID = process.env.CTF_ENVIRONMENT_ID || 'master'

    if (!CTF_SPACE_ID || !CTF_CDA_ACCESS_TOKEN || !CTF_CPA_ACCESS_TOKEN) {
      core.setFailed('Invalid Contentful Client config')
      return
    }

    console.log('CTF_SPACE_ID', CTF_SPACE_ID.length)
    console.log('CTF_CDA_ACCESS_TOKEN', CTF_CDA_ACCESS_TOKEN.length)
    console.log('CTF_CPA_ACCESS_TOKEN', CTF_CPA_ACCESS_TOKEN.length)

    const ctfClient = createClient({
      space: CTF_SPACE_ID,
      accessToken: CTF_CDA_ACCESS_TOKEN,
      environment: CTF_ENVIRONMENT_ID,
      resolveLinks: false, // NOTE: we don't want to resolve the object graph
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      requestLogger: _requestLogger,
      responseLogger: _responseLogger
      // TODO: request/response logging is pretty obnoxious for a Sync Operation (too many requests... ) (Create separate Sync Loggers?)
    })

    // (1) Perform initial Sync
    const syncResult = await ctfClient.sync({
      type: 'all',
      initial: true
    })
    core.info(`executeSyncInit: [${syncResult.nextSyncToken}]`)

    // (2) If supplied, query by a changelist
    if (!changelistId) {
      resultCollection = syncResult
    } else {
      const ctfPreviewClient = createClient({
        space: CTF_SPACE_ID,
        accessToken: CTF_CPA_ACCESS_TOKEN,
        environment: CTF_ENVIRONMENT_ID,
        host: 'preview.contentful.com',
        resolveLinks: false, // NOTE: we don't want to resolve the object graph
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        requestLogger: _requestLogger,
        responseLogger: _responseLogger
      })

      const queryResults = await ctfPreviewClient.getEntries({
        content_type: 'changelist',
        'fields.changelistId': changelistId,
        select: 'sys.id,fields.entries',
        include: 1
      })

      if (queryResults.total === 0) {
        core.warning(`No valid Entries found for Changelist: [${changelistId}]. 
        Will continue with the original SyncCollection`)
        resultCollection = syncResult
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
            item.sys.id === childItem.sys.id
          })
        }) as Entry<any>[]
        const newEntries = changelist.fields.entries?.filter(item => {
          return syncResult.entries.filter(childItem => {
            item.sys.id !== childItem.sys.id
          })
        }) as Entry<any>[]

        const updatedEntryIds = updatedEntries.map(item => item.sys.id)

        // (4.1) Modify Sync Collection
        resultCollection = {
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
        resultCollection.entries.concat(newEntries)
      }
    }

    core.info(`Setting syncFilePath to ${syncFilePath}`)

    fse.ensureFileSync(syncFilePath)

    // TODO: do we care about this being mae explicitly async?
    // await fse.outputJSON(syncFilePath, resultCollection, {
    fse.outputJSONSync(syncFilePath, resultCollection, {
      spaces: 1,
      replacer: null
    })

    core.info('File saved successfully')

    const data = fse.readJsonSync(syncFilePath)
    core.debug(`Entry count: ${data.entries.length})`) // check that content has been written

    // TODO: think of somethign meaningful to output
    core.setOutput(
      'something',
      `There's always gotta be something.... ${new Date().toTimeString()}`
    )
  } catch (error) {
    core.error(error)
    core.setFailed(error.message)
  }
}

run()

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
