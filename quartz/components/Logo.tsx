import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { pathToRoot } from "../util/path"

const Logo: QuartzComponent = ({ fileData, displayClass, cfg }: QuartzComponentProps) => {
    const baseDir = pathToRoot(fileData.slug!)
    return (
        <h1 class={classNames(displayClass, "page-title")}>
            <a href={baseDir}>
                <img src={`/static/logo.png`} alt={cfg.pageTitle} class="logo-image" />
            </a>
        </h1>
    )
}

Logo.css = `
.logo-image {
  height: 40px;
  margin: 0;
  vertical-align: middle;
}
`

export default (() => Logo) satisfies QuartzComponentConstructor
