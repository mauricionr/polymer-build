/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

/// <reference path="../../node_modules/@types/mocha/index.d.ts" />

import {assert} from 'chai';
import * as path from 'path';
import File = require('vinyl');
import {ProjectConfig} from 'polymer-project-config';
import * as sinon from 'sinon';
import {Writable} from 'stream';

import {getFlowingState} from './util';
import {BuildAnalyzer} from '../analyzer';
import {waitForAll} from '../streams';

/**
 * Streams will remain paused unless something is listening for it's data.
 * NoopStream is useful for piping to if you just want the stream to run and end
 * successfully without checking the data passed through it.
 */
class NoopStream extends Writable {
  constructor() {
    super({objectMode: true});
  }
  _write(_chunk: any, _encoding?: string, callback?: Function): void {
    callback();
  }
}

suite('Analyzer', () => {

  suite('DepsIndex', () => {

    test('fragment to deps list has only uniques', () => {
      const config = new ProjectConfig({
        root: `test-fixtures/analyzer-data`,
        entrypoint: 'entrypoint.html',
        fragments: [
          'a.html',
          'b.html',
        ],
        sources: ['a.html', 'b.html', 'entrypoint.html'],
      });

      const analyzer = new BuildAnalyzer(config);
      analyzer.sources.pipe(new NoopStream());
      analyzer.dependencies.pipe(new NoopStream());

      return waitForAll([analyzer.sources, analyzer.dependencies])
          .then(() => {
            return analyzer.analyzeDependencies;
          })
          .then((depsIndex) => {
            const ftd = depsIndex.fragmentToDeps;
            for (const frag of ftd.keys()) {
              assert.deepEqual(
                  ftd.get(frag), ['shared-1.html', 'shared-2.html']);
            }
          });
    });

    test('analyzing shell and entrypoint doesn\'t double load files', () => {
      const root = `test-fixtures/analyzer-data`;
      const sourceFiles =
          ['shell.html', 'entrypoint.html'].map((p) => path.resolve(root, p));
      const config = new ProjectConfig({
        root: root,
        entrypoint: 'entrypoint.html',
        shell: 'shell.html',
        sources: sourceFiles,
      });

      let analyzer = new BuildAnalyzer(config);
      analyzer.sources.pipe(new NoopStream());
      analyzer.dependencies.pipe(new NoopStream());

      return waitForAll([analyzer.sources, analyzer.dependencies])
          .then(() => {
            return analyzer.analyzeDependencies;
          })
          .then((depsIndex) => {
            assert.isTrue(depsIndex.depsToFragments.has('shared-2.html'));
            assert.isFalse(depsIndex.depsToFragments.has('/shell.html'));
            assert.isFalse(depsIndex.depsToFragments.has('/shared-2.html'));
          });
    });

  });

  suite('.dependencies', () => {

    test('outputs all dependencies needed by source', () => {
      const foundDependencies = new Set();
      const root = `test-fixtures/analyzer-data`;
      const sourceFiles =
          ['shell.html', 'entrypoint.html'].map((p) => path.resolve(root, p));
      const config = new ProjectConfig({
        root: root,
        entrypoint: 'entrypoint.html',
        shell: 'shell.html',
        sources: sourceFiles,
      });

      let analyzer = new BuildAnalyzer(config);
      analyzer.sources.pipe(new NoopStream());
      analyzer.dependencies.on('data', (file: File) => {
        foundDependencies.add(file.path);
      });

      return waitForAll([analyzer.sources, analyzer.dependencies]).then(() => {
        // shared-1 is never imported by shell/entrypoint, so it is not
        // included as a dep.
        assert.isFalse(
            foundDependencies.has(path.resolve(root, 'shared-1.html')));
        // shared-2 is imported by shell, so it is included as a dep.
        assert.isTrue(
            foundDependencies.has(path.resolve(root, 'shared-2.html')));
      });
    });

    test(
        'outputs all dependencies needed by source and given fragments', () => {
          const foundDependencies = new Set();
          const root = `test-fixtures/analyzer-data`;
          const sourceFiles =
              ['a.html', 'b.html', 'shell.html', 'entrypoint.html'].map(
                  (p) => path.resolve(root, p));
          const config = new ProjectConfig({
            root: root,
            entrypoint: 'entrypoint.html',
            shell: 'shell.html',
            fragments: [
              'a.html',
              'b.html',
            ],
            sources: sourceFiles,
          });
          const analyzer = new BuildAnalyzer(config);
          analyzer.sources.pipe(new NoopStream());
          analyzer.dependencies.on('data', (file: File) => {
            foundDependencies.add(file.path);
          });

          return waitForAll([analyzer.sources, analyzer.dependencies])
              .then(() => {
                // shared-1 is imported by 'a' & 'b', so it is included as a
                // dep.
                assert.isTrue(
                    foundDependencies.has(path.resolve(root, 'shared-1.html')));
                // shared-1 is imported by 'a' & 'b', so it is included as a
                // dep.
                assert.isTrue(
                    foundDependencies.has(path.resolve(root, 'shared-2.html')));
              });
        });
  });

  test(
      'the analyzer stream will emit an error when an warning of type "error" occurs during analysis',
      () => {
        const root = path.resolve('test-fixtures/project-analysis-error');
        const sourceFiles = path.join(root, '**');
        const config = new ProjectConfig({
          root: root,
          sources: [sourceFiles],
        });

        const analyzer = new BuildAnalyzer(config);
        analyzer.sources.pipe(new NoopStream());
        analyzer.dependencies.pipe(new NoopStream());

        return waitForAll([analyzer.sources, analyzer.dependencies])
            .then(
                () => {
                  throw new Error('Parse error expected!');
                },
                (err) => {
                  assert.isDefined(err);
                  assert.equal(
                      err.message, '1 error(s) occurred during build.');
                });
      });

  test(
      'the analyzer stream will log all analysis warnings at the end of the stream',
      () => {
        const root = path.resolve('test-fixtures/project-analysis-error');
        const sourceFiles = path.join(root, '**');
        const config = new ProjectConfig({
          root: root,
          sources: [sourceFiles],
        });

        const analyzer = new BuildAnalyzer(config);
        const printWarningsSpy = sinon.spy(analyzer, 'printWarnings');
        analyzer.sources.on(
            'data', () => assert.isFalse(printWarningsSpy.called));
        analyzer.dependencies.on(
            'data', () => assert.isFalse(printWarningsSpy.called));

        return waitForAll([analyzer.sources, analyzer.dependencies])
            .then(
                () => {
                  throw new Error('Parse error expected!');
                },
                (_err: Error) => {
                  assert.isTrue(printWarningsSpy.calledOnce);
                });
      });

  test('the source/dependency streams remain paused until use', () => {
    const config = new ProjectConfig({
      root: `test-fixtures/analyzer-data`,
      entrypoint: 'entrypoint.html',
      fragments: [
        'a.html',
        'b.html',
      ],
      sources: ['a.html', 'b.html', 'entrypoint.html'],
    });

    const analyzer = new BuildAnalyzer(config);

    // Check that data isn't flowing through sources until consumer usage
    assert.isNull(getFlowingState(analyzer.sources));
    analyzer.sources.on('data', () => {});
    assert.isTrue(getFlowingState(analyzer.sources));

    // Check that data isn't flowing through dependencies until consumer usage
    assert.isNull(getFlowingState(analyzer.dependencies));
    analyzer.dependencies.on('data', () => {});
    assert.isTrue(getFlowingState(analyzer.dependencies));
  });

  // TODO(fks) 10-26-2016: Refactor logging to be testable, and configurable by
  // the consumer.
  suite.skip('.printWarnings()', () => {});
});
