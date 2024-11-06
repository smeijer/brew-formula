# brew-formula

This package lets you create a brew formula for a npm package, pushed to
your own tap repo using the github token.

## Requirements

Node 18 or higher.

## Usage

```shell
npx brew-formula github <package-name> <repo> \
  --test-command 'my-bin logout' \
  --test-output '/you are not logged in/i'
```
