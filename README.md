<p align="center">
  <a href="https://github.com/actions/typescript-action/actions"><img alt="typescript-action status" src="https://github.com/actions/typescript-action/workflows/build-test/badge.svg"></a>
</p>

# Contentful Changelist Sync - Github Action

Custom Github Action to overlay a SyncCollection with updated `Entries` from a `Changelist`

(These are special ContentTypes which the action depends on. Feel free to make the query more generic)

---

This project was bootstrapped from the [Typescript Action Template](https://github.com/actions/typescript-action) & includes compilation support, tests, a validation workflow, publishing, and versioning guidance.

## Code in Main

Install the dependencies

```bash
$ npm install
```

Build the typescript and package it for distribution

```bash
$ npm run build && npm run package
```

Run the tests :heavy_check_mark:

```bash
$ npm test

 PASS  ./index.test.js
  ✓ throws invalid number (3ms)
  ✓ wait 500 ms (504ms)
  ✓ test runs (95ms)

...
```

## Testing Github Actions locally with ACT

[ACT is allows you to execute github actions](https://github.com/nektos/act)

1. `brew install act`

2. copy & update

- `.secrets.template` ==> `.secrets`
- `.env.template` ==> `.env`

3. Modify [`test-run.yml`](./.github/workflows/test-run.yml) to suit your needs

4. Run one of the sample workflows

```shell-script

## Test Compilation
act --secret-file .secrets --env-file .env --workflows .github/workflows/test-build.yml

## Test Execution
act --secret-file .secrets --env-file .env --workflows .github/workflows/test-run.yml

```

#### All together now!

```shell-script
npm run bundle && act --secret-file .secrets --env-file .env --workflows .github/workflows/test-run.yml
```

---

--

See the [toolkit documentation](https://github.com/actions/toolkit/blob/master/README.md#packages) for the various packages.

## Publish to a distribution branch

Actions are run from GitHub repos, so we will checkin the packed dist folder.

Then run [ncc](https://github.com/zeit/ncc) and push the results:

```bash
npm run package
git add dist
git commit -a -m "prod dependencies"
# Tag the release
git tag v1 main
# Push the tag the release 
git push origin v1
```

Note: We recommend using the `--license` option for ncc, which will create a license file for all of the production node modules used in your project.

Your action is now published! :rocket:

See the [versioning documentation](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)

## Validate

You can now validate the action by referencing `./` in a workflow in your repo (see [test.yml](.github/workflows/test.yml))

```yaml
uses: ./
with:
  milliseconds: 1000
```

See the [actions tab](https://github.com/actions/typescript-action/actions) for runs of this action! :rocket:

## Usage:

After testing, you can [create a v1 tag](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md) to reference the stable and latest V1 action
