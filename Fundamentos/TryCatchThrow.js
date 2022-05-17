function Tratar_Erro_para_Lancar(erro) {
    throw new Error('Estamos Consertando !!!')
    throw true
}

function imprimirNomeGritado(obj) {
    try { // Codigo que dará o erro
        console.log(obj.name.toUpper() + '!!!')
    } catch (e) { // Como irá tratar o erro
        Tratar_Erro_para_Lancar(e)
    } finally { // Sempre aparece no final
        console.log('Final...')
    }
}

const obj = { nome: 'Roberto'}
imprimirNomeGritado(obj)