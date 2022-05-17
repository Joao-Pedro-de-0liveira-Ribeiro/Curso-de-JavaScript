function soBoaNoticia (nota) {
    if (nota >= 7) {
        console.log('Aprovado com ' + nota)
    }
}

soBoaNoticia(8.2)
soBoaNoticia(6.2)

function seForVerdade(valor) {
    if (valor) {
        console.log('É verdade...' + valor)
    }
}

seForVerdade()
seForVerdade(null)
seForVerdade(undefined)
seForVerdade(NaN)
seForVerdade('')
seForVerdade(0) // É considerado um elemento falso
seForVerdade(-1)
seForVerdade(' ')
seForVerdade('?')
seForVerdade([])
seForVerdade([1, 2])
seForVerdade({})