import {createClient, Entry, SyncCollection} from 'contentful'
import * as core from '@actions/core'
import {IChangelist, LocalSyncCollection} from '../@types/contentful'

async function run(): Promise<void> {
  try {
      const changelistId: string = core.getInput('ctf-query')
      core.debug(`ctf-changelist-sync | arbitrary debug message`) // NOTE: debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
      core.info(`ctf-changelist-sync | changelist: [${changelistId}]`)

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

      const ctfClient = createClient({
          space: CTF_SPACE_ID,
          accessToken: CTF_CDA_ACCESS_TOKEN,
          environment: CTF_ENVIRONMENT_ID,
          resolveLinks: false // NOTE: we don't want to resolve the object graph
      })

      // (1) Perform initial Sync
      const syncResult = await ctfClient.sync({
          type: 'all',
          initial: true
      })
      core.info(`executeSyncInit: [${syncResult.nextSyncToken}]`)

      // (2) If supplied, query by a changelist
      if (!changelistId) {
          resultCollection = syncResult;
      } else {
          const ctfPreviewClient = createClient({
              space: CTF_SPACE_ID,
              accessToken: CTF_CPA_ACCESS_TOKEN,
              environment: CTF_ENVIRONMENT_ID,
              host: 'preview.contentful.com',
              resolveLinks: false // NOTE: we don't want to resolve the object graph
          })
          const changelist: IChangelist = (
              await ctfPreviewClient.getEntries({
                  content_type: 'changelist',
                  'fields.changelistid': changelistId,
                  select: 'sys.id,fields.entries',
                  include: 1
              })
          ).items[0] as IChangelist

          core.info(
              `Changelist [${changelistId}] contains ${changelist.fields.entries?.length} entries`
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
    core.setOutput(
      'something',
      `There's always gotta be something.... ${new Date().toTimeString()}`
    )
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
